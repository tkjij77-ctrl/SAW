// @ts-nocheck -- Hugging Face SDK file types vary across runtime versions.
import { uploadFiles } from "npm:@huggingface/hub@2.13.3";
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

const VERSION = "3.2.0";
const TEMPLATE_BASE =
  "https://raw.githubusercontent.com/tkjij77-ctrl/SAW/master/provisioning-template";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function template(path: string): Promise<Blob> {
  const response = await fetchWithTimeout(`${TEMPLATE_BASE}/${path}`, {
    headers: { "User-Agent": `SAW-Agent-Upgrader/${VERSION}` },
  }, 15_000);
  if (!response.ok) {
    throw new AppError(
      "TEMPLATE_UNAVAILABLE",
      `Agent template is unavailable: ${path}`,
      502,
    );
  }
  return response.blob();
}

async function configureSpace(
  repoId: string,
  kind: "secrets" | "variables",
  key: string,
  value: string,
  token: string,
) {
  const response = await fetchWithTimeout(
    `https://huggingface.co/api/spaces/${encodeURI(repoId)}/${kind}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ key, value }),
    },
    20_000,
  );
  if (!response.ok) {
    throw new AppError(
      "SPACE_CONFIG_FAILED",
      `Could not configure Space ${kind}`,
      response.status === 401 || response.status === 403 ? 403 : 502,
    );
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const requestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();
  try {
    assertPost(req);
    const ctx = await authenticate(req);
    await rateLimit(ctx.admin, ctx.user.id, "agent.upgrade", 3, 3600);
    const body = await readJson(req, 4096);
    const serverId = String(body.server_id || "");
    if (!UUID.test(serverId)) {
      throw new AppError(
        "INVALID_SERVER_ID",
        "A valid server ID is required",
        400,
      );
    }

    const { data: server, error: serverError } = await ctx.admin.from("servers")
      .select("id,owner_id,hf_space_id,dataset_repo_id,template_version")
      .eq("id", serverId).eq("owner_id", ctx.user.id).maybeSingle();
    if (serverError) {
      throw new AppError("DATABASE_ERROR", "Could not read the server", 500);
    }
    if (!server) {
      throw new AppError(
        "SERVER_NOT_FOUND",
        "Only the server owner can upgrade its Agent",
        404,
      );
    }
    if (!server.dataset_repo_id) {
      throw new AppError(
        "DATASET_NOT_CONFIGURED",
        "This server has no backup Dataset configured",
        409,
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
        "Reconnect Hugging Face before upgrading",
        409,
      );
    }
    const token = connection.access_token;

    const [app, requirements, readme] = await Promise.all([
      template("app.py"),
      template("requirements.txt"),
      template("README.md"),
    ]);
    try {
      await uploadFiles({
        repo: { type: "space", name: server.hf_space_id },
        accessToken: token,
        commitTitle: `Upgrade SAW Minecraft Agent to v${VERSION}`,
        files: [
          { path: "app.py", content: app },
          { path: "requirements.txt", content: requirements },
          { path: "README.md", content: readme },
        ],
      });
    } catch {
      throw new AppError(
        "AGENT_UPLOAD_FAILED",
        "Could not upload the new Agent files",
        502,
      );
    }

    await configureSpace(
      server.hf_space_id,
      "variables",
      "DATASET_REPO_ID",
      server.dataset_repo_id,
      token,
    );
    await configureSpace(
      server.hf_space_id,
      "variables",
      "SERVER_ID",
      server.id,
      token,
    );
    for (
      const [key, value] of Object.entries({
        AUTO_RESTORE: "true",
        AUTO_BACKUP: "true",
        BACKUP_INTERVAL_MINUTES: "60",
        BACKUP_RETENTION: "5",
        MAX_CHUNKED_UPLOAD_SIZE: "536870912",
      })
    ) {
      await configureSpace(server.hf_space_id, "variables", key, value, token);
    }
    await configureSpace(
      server.hf_space_id,
      "secrets",
      "HF_TOKEN",
      token,
      token,
    );

    const { error: updateError } = await ctx.admin.from("servers").update({
      template_version: VERSION,
    }).eq("id", server.id).eq("owner_id", ctx.user.id);
    if (updateError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Agent was uploaded but its version could not be recorded",
        500,
      );
    }
    await ctx.admin.from("audit_logs").insert({
      server_id: server.id,
      user_id: ctx.user.id,
      action: "agent.upgrade",
      details: {
        from: server.template_version,
        to: VERSION,
        request_id: ctx.requestId,
      },
    });

    return jsonResponse(
      {
        ok: true,
        version: VERSION,
        previous_version: server.template_version,
        request_id: ctx.requestId,
      },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, requestId);
  }
});
