import {
  AppError,
  assertPost,
  authenticate,
  errorResponse,
  fetchWithTimeout,
  handleOptions,
  jsonResponse,
  rateLimit,
  readJson,
} from "../_shared/core.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const fallbackRequestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();

  try {
    assertPost(req);
    const ctx = await authenticate(req);
    await rateLimit(ctx.admin, ctx.user.id, "provision.status", 90, 60);
    const body = await readJson(req, 4096);
    const jobId = String(body.job_id || "");
    if (!UUID.test(jobId)) {
      throw new AppError(
        "INVALID_JOB_ID",
        "A valid provisioning job ID is required",
        400,
      );
    }

    const { data: job, error: jobError } = await ctx.admin.from(
      "provisioning_jobs",
    )
      .select("*").eq("id", jobId).eq("user_id", ctx.user.id).maybeSingle();
    if (jobError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not read the provisioning job",
        500,
      );
    }
    if (!job) {
      throw new AppError(
        "JOB_NOT_FOUND",
        "Provisioning job was not found",
        404,
      );
    }

    if (["failed", "cancelled", "running"].includes(job.state)) {
      return jsonResponse(
        { ok: true, job, request_id: ctx.requestId },
        200,
        req,
        ctx.requestId,
      );
    }

    const { data: connection, error: connectionError } = await ctx.admin.from(
      "hf_connections",
    )
      .select("access_token").eq("user_id", ctx.user.id).maybeSingle();
    if (connectionError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not read the Hugging Face connection",
        500,
      );
    }
    if (!connection) {
      throw new AppError(
        "HF_NOT_CONNECTED",
        "Reconnect Hugging Face to continue",
        409,
      );
    }

    const runtimeResponse = await fetchWithTimeout(
      `https://huggingface.co/api/spaces/${
        encodeURI(job.space_repo_id)
      }/runtime`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/json",
        },
      },
      15_000,
    );
    if (runtimeResponse.status === 404) {
      throw new AppError(
        "SPACE_NOT_FOUND",
        "The Hugging Face Space no longer exists",
        404,
      );
    }
    if (runtimeResponse.status === 401 || runtimeResponse.status === 403) {
      throw new AppError(
        "HF_PERMISSION_DENIED",
        "Hugging Face access must be reconnected",
        403,
      );
    }
    if (!runtimeResponse.ok) {
      throw new AppError(
        "HF_RUNTIME_UNAVAILABLE",
        "Could not read the Hugging Face Space status",
        502,
      );
    }

    const runtime = await runtimeResponse.json() as Record<string, unknown>;
    const stage = String(runtime.stage || "UNKNOWN").toUpperCase();
    const now = new Date().toISOString();
    let values: Record<string, unknown> = {
      state: "building",
      step: "building",
      progress: Math.max(job.progress || 75, 80),
      updated_at: now,
    };

    if (stage === "RUNNING") {
      values = {
        state: "running",
        step: "running",
        progress: 100,
        error_code: null,
        error_message: null,
        updated_at: now,
      };
      if (job.server_id) {
        await ctx.admin.from("servers").update({
          provision_status: "running",
          provision_step: "running",
          provision_error: null,
        }).eq("id", job.server_id).eq("owner_id", ctx.user.id);
      }
    } else if (stage.includes("ERROR") || stage.includes("FAILED")) {
      values = {
        state: "failed",
        step: "failed",
        progress: 100,
        error_code: "SPACE_BUILD_FAILED",
        error_message: `Hugging Face stage: ${stage}`,
        updated_at: now,
      };
      if (job.server_id) {
        await ctx.admin.from("servers").update({
          provision_status: "failed",
          provision_step: "failed",
          provision_error: values.error_message,
        }).eq("id", job.server_id).eq("owner_id", ctx.user.id);
      }
    }

    const { data: updated, error: updateError } = await ctx.admin.from(
      "provisioning_jobs",
    )
      .update(values).eq("id", job.id).eq("user_id", ctx.user.id).select()
      .single();
    if (updateError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not update the provisioning status",
        500,
      );
    }

    return jsonResponse(
      { ok: true, job: updated, runtime: { stage }, request_id: ctx.requestId },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackRequestId);
  }
});
