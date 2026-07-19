// @ts-nocheck -- Hugging Face SDK response types vary between runtime versions.
import { createRepo, uploadFiles } from "npm:@huggingface/hub@2.13.3";
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
  safeMessage,
} from "../_shared/core.ts";

const TEMPLATE_BASE =
  "https://raw.githubusercontent.com/tkjij77-ctrl/SAW/master/provisioning-template";
const TEMPLATE_VERSION = "3.2.0";
const SUPPORTED_VERSIONS = new Set([
  "1.20.6",
  "1.21",
  "1.21.1",
  "1.21.3",
  "1.21.4",
  "1.21.5",
  "1.21.6",
  "1.21.7",
  "1.21.8",
  "1.21.9",
  "1.21.10",
  "1.21.11",
  "26.1.2",
  "26.2",
]);

async function fetchTemplate(path: string): Promise<Blob> {
  const result = await fetchWithTimeout(`${TEMPLATE_BASE}/${path}`, {
    headers: { "User-Agent": `SAW-Provisioner/${TEMPLATE_VERSION}` },
  }, 15_000);
  if (!result.ok) {
    throw new AppError(
      "TEMPLATE_UNAVAILABLE",
      `Required Agent template is unavailable: ${path}`,
      502,
    );
  }
  return await result.blob();
}

async function createZeroGpuSpace(
  owner: string,
  name: string,
  variables: Record<string, string>,
  token: string,
) {
  const payload = {
    name,
    organization: null,
    visibility: "private",
    type: "space",
    sdk: "gradio",
    hardware: "zero-a10g",
    variables: Object.entries(variables).map(([key, value]) => ({
      key,
      value,
    })),
  };

  for (let attempt = 0; attempt < 5; attempt++) {
    const result = await fetchWithTimeout(
      "https://huggingface.co/api/repos/create",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      },
      20_000,
    );
    if (result.ok) return;

    const upstreamMessage = await result.text();
    if (
      result.status === 409 &&
      upstreamMessage.toLowerCase().includes("conflicting operation")
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000 + attempt * 500));
      continue;
    }
    if (result.status === 401 || result.status === 403) {
      throw new AppError(
        "HF_PERMISSION_DENIED",
        "Reconnect Hugging Face with repository management permission",
        403,
      );
    }
    if (result.status === 409) {
      throw new AppError(
        "SPACE_ALREADY_EXISTS",
        `The Hugging Face Space ${owner}/${name} already exists`,
        409,
      );
    }
    if (result.status === 402) {
      throw new AppError(
        "HF_HARDWARE_UNAVAILABLE",
        "ZeroGPU is not currently available for this Hugging Face account",
        409,
      );
    }
    throw new AppError(
      "SPACE_CREATE_FAILED",
      "Hugging Face could not create the ZeroGPU Space",
      502,
    );
  }
  throw new AppError(
    "HF_CONFLICT_TIMEOUT",
    "Hugging Face is busy with another repository operation. Try again shortly",
    503,
  );
}

async function setSpaceSecret(
  repoId: string,
  key: string,
  value: string,
  token: string,
) {
  const response = await fetchWithTimeout(
    `https://huggingface.co/api/spaces/${encodeURI(repoId)}/secrets`,
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
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "HF_PERMISSION_DENIED",
      "Hugging Face refused to configure secure Dataset backups",
      403,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "SPACE_SECRET_FAILED",
      "The Space was created but its secure backup credential could not be configured",
      502,
    );
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const fallbackRequestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();
  let ctx: any = null;
  let jobId: string | null = null;

  try {
    assertPost(req);
    ctx = await authenticate(req);
    await rateLimit(ctx.admin, ctx.user.id, "provision.create", 3, 600);
    const input = await readJson(req, 16_384);

    const spaceName = String(input.space_name || "").trim().toLowerCase();
    const displayName = String(input.display_name || spaceName).trim();
    const minecraftVersion = String(input.minecraft_version || "1.21.1").trim();
    const rawMaxPlayers = Number(input.max_players ?? 20);
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(spaceName)) {
      throw new AppError(
        "INVALID_SPACE_NAME",
        "Space name must be 3-64 lowercase characters",
        400,
      );
    }
    if (
      !displayName || displayName.length > 80 || /[\r\n\0]/.test(displayName)
    ) {
      throw new AppError(
        "INVALID_DISPLAY_NAME",
        "Display name must be 1-80 characters",
        400,
      );
    }
    if (!SUPPORTED_VERSIONS.has(minecraftVersion)) {
      throw new AppError(
        "VERSION_NOT_SUPPORTED",
        "This Minecraft version is not enabled for automatic crossplay",
        400,
      );
    }
    if (
      !Number.isInteger(rawMaxPlayers) || rawMaxPlayers < 1 ||
      rawMaxPlayers > 100
    ) {
      throw new AppError(
        "INVALID_MAX_PLAYERS",
        "Max players must be an integer from 1 to 100",
        400,
      );
    }

    const { data: connection, error: connectionError } = await ctx.admin.from(
      "hf_connections",
    )
      .select("hf_username,access_token").eq("user_id", ctx.user.id)
      .maybeSingle();
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
        "Connect Hugging Face before creating a server",
        409,
      );
    }

    // Validate the saved token before creating any resource.
    const profileResponse = await fetchWithTimeout(
      "https://huggingface.co/oauth/userinfo",
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/json",
        },
      },
      15_000,
    );
    if (!profileResponse.ok) {
      throw new AppError(
        "HF_SESSION_EXPIRED",
        "Reconnect Hugging Face before creating a server",
        401,
      );
    }
    const profile = await profileResponse.json() as Record<string, unknown>;
    const actualOwner = String(
      profile.preferred_username || profile.name || profile.nickname || "",
    ).trim();
    if (
      !actualOwner ||
      actualOwner.toLowerCase() !== String(connection.hf_username).toLowerCase()
    ) {
      throw new AppError(
        "HF_ACCOUNT_MISMATCH",
        "The connected Hugging Face account changed. Reconnect it first",
        409,
      );
    }

    const hfToken = connection.access_token;
    const owner = connection.hf_username;
    const spaceRepoId = `${owner}/${spaceName}`;
    const datasetRepoId = `${owner}/${spaceName}-data`;
    const serverId = crypto.randomUUID();

    const { data: duplicate, error: duplicateError } = await ctx.admin.from(
      "servers",
    )
      .select("id").eq("owner_id", ctx.user.id).eq("hf_space_id", spaceRepoId)
      .maybeSingle();
    if (duplicateError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not check existing servers",
        500,
      );
    }
    if (duplicate) {
      throw new AppError(
        "SERVER_ALREADY_REGISTERED",
        "This server is already registered in your account",
        409,
      );
    }

    const { data: activeJob } = await ctx.admin.from("provisioning_jobs")
      .select("id")
      .eq("user_id", ctx.user.id).eq("space_repo_id", spaceRepoId)
      .not("state", "in", "(failed,cancelled,running)").maybeSingle();
    if (activeJob) {
      throw new AppError(
        "PROVISION_ALREADY_RUNNING",
        "This server is already being prepared",
        409,
        { job_id: activeJob.id },
      );
    }

    const { data: job, error: jobError } = await ctx.admin.from(
      "provisioning_jobs",
    ).insert({
      user_id: ctx.user.id,
      server_id: null,
      space_repo_id: spaceRepoId,
      dataset_repo_id: datasetRepoId,
      state: "validating",
      step: "validating",
      progress: 5,
    }).select().single();
    if (jobError) {
      if (jobError.code === "23505") {
        throw new AppError(
          "PROVISION_ALREADY_RUNNING",
          "This server is already being prepared",
          409,
        );
      }
      throw new AppError(
        "JOB_CREATE_FAILED",
        "Could not create the provisioning job",
        500,
      );
    }
    jobId = job.id;

    const updateJob = async (values: Record<string, unknown>) => {
      const { error } = await ctx.admin.from("provisioning_jobs")
        .update(values).eq("id", jobId).eq("user_id", ctx.user.id);
      if (error) {
        throw new AppError(
          "JOB_UPDATE_FAILED",
          "Could not update the provisioning job",
          500,
        );
      }
    };

    await updateJob({
      state: "creating_dataset",
      step: "creating_dataset",
      progress: 15,
    });
    const datasetCheck = await fetchWithTimeout(
      `https://huggingface.co/api/datasets/${encodeURI(datasetRepoId)}`,
      {
        headers: {
          Authorization: `Bearer ${hfToken}`,
          Accept: "application/json",
        },
      },
      15_000,
    );
    if (datasetCheck.status === 404) {
      try {
        await createRepo({
          repo: { type: "dataset", name: datasetRepoId },
          visibility: "private",
          accessToken: hfToken,
          files: [{
            path: "README.md",
            content: new Blob([
              `---\npretty_name: ${
                displayName.replace(/[\r\n]/g, " ")
              } Backups\n---\n\nPrivate backup repository managed by SAW MC Hosting.\n`,
            ], { type: "text/markdown" }),
          }],
        });
      } catch (datasetError) {
        const verifyExisting = await fetchWithTimeout(
          `https://huggingface.co/api/datasets/${encodeURI(datasetRepoId)}`,
          {
            headers: {
              Authorization: `Bearer ${hfToken}`,
              Accept: "application/json",
            },
          },
          15_000,
        );
        if (!verifyExisting.ok) {
          throw new AppError(
            "DATASET_CREATE_FAILED",
            "Could not create the private backup Dataset",
            502,
          );
        }
      }
    } else if (datasetCheck.status === 401 || datasetCheck.status === 403) {
      throw new AppError(
        "HF_PERMISSION_DENIED",
        "Reconnect Hugging Face with repository management permission",
        403,
      );
    } else if (!datasetCheck.ok) {
      throw new AppError(
        "DATASET_CHECK_FAILED",
        "Could not verify the private backup Dataset",
        502,
      );
    }

    await updateJob({
      state: "creating_space",
      step: "creating_space",
      progress: 30,
    });
    const [appFile, requirementsFile, readmeFile] = await Promise.all([
      fetchTemplate("app.py"),
      fetchTemplate("requirements.txt"),
      fetchTemplate("README.md"),
    ]);
    const variables: Record<string, string> = {
      ACCEPT_EULA: "true",
      AUTO_START: "true",
      MC_VERSION: minecraftVersion,
      MC_XMS: "512M",
      MC_XMX: "2G",
      INSTALL_CROSSPLAY: "true",
      INSTALL_VIA_SUITE: "true",
      INSTALL_PLAYIT: "true",
      DATASET_REPO_ID: datasetRepoId,
      SERVER_ID: serverId,
      MAX_PLAYERS: String(rawMaxPlayers),
      AUTO_RESTORE: "true",
      AUTO_BACKUP: "true",
      BACKUP_INTERVAL_MINUTES: "60",
      BACKUP_RETENTION: "5",
      MAX_CHUNKED_UPLOAD_SIZE: "536870912",
    };

    await updateJob({
      state: "setting_hardware",
      step: "setting_hardware",
      progress: 42,
    });
    await createZeroGpuSpace(owner, spaceName, variables, hfToken);
    await setSpaceSecret(spaceRepoId, "HF_TOKEN", hfToken, hfToken);

    await updateJob({
      state: "setting_variables",
      step: "setting_variables",
      progress: 58,
    });
    try {
      await uploadFiles({
        repo: { type: "space", name: spaceRepoId },
        accessToken: hfToken,
        commitTitle: `Install SAW Minecraft Agent v${TEMPLATE_VERSION}`,
        files: [
          { path: "app.py", content: appFile },
          { path: "requirements.txt", content: requirementsFile },
          { path: "README.md", content: readmeFile },
        ],
      });
    } catch {
      throw new AppError(
        "TEMPLATE_UPLOAD_FAILED",
        "The Space was created but Agent files could not be uploaded",
        502,
      );
    }

    const { data: server, error: serverError } = await ctx.admin.from("servers")
      .insert({
        id: serverId,
        owner_id: ctx.user.id,
        name: displayName,
        hf_space_id: spaceRepoId,
        dataset_repo_id: datasetRepoId,
        provision_status: "building",
        provision_step: "building",
        hardware: "zero-a10g",
        template_version: TEMPLATE_VERSION,
        minecraft_version: minecraftVersion,
      }).select().single();
    if (serverError) {
      throw new AppError(
        "SERVER_REGISTER_FAILED",
        "Resources were created but the server could not be registered",
        500,
      );
    }

    await updateJob({
      server_id: serverId,
      state: "building",
      step: "building",
      progress: 75,
    });
    await ctx.admin.from("audit_logs").insert({
      server_id: serverId,
      user_id: ctx.user.id,
      action: "server.provision",
      details: {
        space_repo_id: spaceRepoId,
        dataset_repo_id: datasetRepoId,
        minecraft_version: minecraftVersion,
        request_id: ctx.requestId,
      },
    });

    return jsonResponse(
      {
        ok: true,
        job_id: jobId,
        server,
        space_repo_id: spaceRepoId,
        dataset_repo_id: datasetRepoId,
        hardware: "zero-a10g",
        request_id: ctx.requestId,
      },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    const message = safeMessage(error);
    const code = error instanceof AppError ? error.code : "PROVISION_FAILED";
    if (!(error instanceof AppError)) {
      console.error(
        `[${fallbackRequestId}] Provision failed:`,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (ctx?.admin && jobId) {
      await ctx.admin.from("provisioning_jobs").update({
        state: "failed",
        step: "failed",
        progress: 100,
        error_code: code,
        error_message: message,
      }).eq("id", jobId).eq("user_id", ctx.user.id);
    }
    return errorResponse(error, req, ctx?.requestId || fallbackRequestId);
  }
});
