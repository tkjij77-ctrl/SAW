// @ts-nocheck -- Gradio responses are runtime-validated.
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
const endpoints: Record<string, string> = {
  status: "server_status",
  logs: "server_logs",
  resources: "server_resources",
  players: "server_players",
  start: "start_server",
  stop: "stop_server",
  restart: "restart_server",
  command: "send_command",
  file_list: "files_list",
  file_read: "file_read",
  file_write: "file_write",
  file_write_safe: "file_write_safe",
  file_write_safe_status: "file_write_safe_status",
  file_upload: "file_upload",
  file_upload_init: "file_upload_init",
  file_upload_chunk: "file_upload_chunk",
  file_upload_status: "file_upload_status",
  file_upload_complete: "file_upload_complete",
  file_upload_abort: "file_upload_abort",
  file_download: "file_download",
  file_create: "file_create",
  file_rename: "file_rename",
  file_delete: "file_delete",
  backup_list: "backup_list",
  backup_create: "backup_create",
  backup_delete: "backup_delete",
  backup_restore: "backup_restore",
  backup_status: "backup_status",
  plugin_install: "plugin_install",
};
const allowed: Record<string, Set<string>> = {
  owner: new Set(Object.keys(endpoints)),
  admin: new Set(Object.keys(endpoints)),
  operator: new Set([
    "status",
    "logs",
    "resources",
    "players",
    "start",
    "stop",
    "restart",
    "command",
    "file_list",
    "file_read",
    "file_download",
    "backup_list",
    "backup_status",
    "backup_create",
  ]),
  editor: new Set([
    "status",
    "logs",
    "resources",
    "players",
    "file_list",
    "file_read",
    "file_write",
    "file_write_safe",
    "file_write_safe_status",
    "file_upload",
    "file_upload_init",
    "file_upload_chunk",
    "file_upload_status",
    "file_upload_complete",
    "file_upload_abort",
    "file_download",
    "file_create",
    "file_rename",
    "file_delete",
    "backup_list",
    "backup_status",
    "backup_create",
    "plugin_install",
  ]),
  viewer: new Set([
    "status",
    "logs",
    "resources",
    "players",
    "file_list",
    "file_read",
    "file_download",
    "backup_list",
    "backup_status",
  ]),
};
const safeOperatorCommands =
  /^(list|say [^\r\n]{1,240}|tell \S{1,40} [^\r\n]{1,200}|tps|mspt|save-all(?: flush)?)$/i;
const readActions = new Set([
  "status",
  "logs",
  "resources",
  "players",
  "file_list",
  "file_read",
  "file_download",
  "file_write_safe_status",
  "backup_list",
  "backup_status",
]);
const powerActions = new Set(["start", "stop", "restart"]);
const backupActions = new Set([
  "backup_create",
  "backup_delete",
  "backup_restore",
]);
const installerActions = new Set(["plugin_install"]);
const uploadChunkActions = new Set(["file_upload_chunk", "file_upload_status"]);
const auditedActions = new Set([
  "start",
  "stop",
  "restart",
  "command",
  "file_write",
  "file_write_safe",
  "file_upload",
  "file_upload_complete",
  "file_upload_abort",
  "file_create",
  "file_rename",
  "file_delete",
  "backup_create",
  "backup_delete",
  "backup_restore",
  "plugin_install",
]);

function text(value: unknown, max: number, field: string): string {
  const result = typeof value === "string" ? value : "";
  if (result.length > max) {
    throw new AppError("INVALID_INPUT", `${field} is too long`, 400);
  }
  return result;
}

function safePath(value: unknown): string {
  const path = text(value, 1024, "path");
  if (
    path.includes("\0") || path.includes("\\") || path.split("/").includes("..")
  ) {
    throw new AppError("INVALID_PATH", "The file path is not allowed", 400);
  }
  return path.replace(/^\/+/, "");
}

async function gradioCall(
  host: string,
  endpoint: string,
  data: unknown[],
  hfToken: string,
) {
  const base = `https://${host}`;
  const headers = {
    Authorization: `Bearer ${hfToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  const start = await fetchWithTimeout(`${base}/gradio_api/call/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data }),
  }, 20_000);
  if (!start.ok) {
    throw new AppError(
      "AGENT_REJECTED",
      "The Minecraft Agent rejected the request",
      502,
    );
  }

  const started = await start.json() as Record<string, unknown>;
  if (!started.event_id) return started;
  const result = await fetchWithTimeout(
    `${base}/gradio_api/call/${endpoint}/${started.event_id}`,
    {
      headers: {
        Authorization: `Bearer ${hfToken}`,
        Accept: "text/event-stream",
      },
    },
    endpoint.startsWith("backup_") || endpoint === "file_write_safe"
      ? 300_000
      : endpoint === "plugin_install"
      ? 180_000
      : 60_000,
  );
  if (!result.ok) {
    throw new AppError(
      "AGENT_RESULT_FAILED",
      "The Minecraft Agent did not complete the request",
      502,
    );
  }

  const payloads = (await result.text()).split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim()).filter(Boolean);
  if (!payloads.length) {
    throw new AppError(
      "AGENT_EMPTY_RESPONSE",
      "The Minecraft Agent returned no result",
      502,
    );
  }
  try {
    const parsed = JSON.parse(payloads[payloads.length - 1]);
    return Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
  } catch {
    throw new AppError(
      "AGENT_INVALID_RESPONSE",
      "The Minecraft Agent returned an invalid result",
      502,
    );
  }
}

async function ensureSpaceAwake(
  repoId: string,
  hfToken: string,
): Promise<void> {
  const runtimeUrl = `https://huggingface.co/api/spaces/${
    encodeURI(repoId)
  }/runtime`;
  const headers = {
    Authorization: `Bearer ${hfToken}`,
    Accept: "application/json",
  };
  const runtimeResponse = await fetchWithTimeout(
    runtimeUrl,
    { headers },
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
      "The owner must reconnect Hugging Face",
      403,
    );
  }
  if (!runtimeResponse.ok) {
    throw new AppError(
      "HF_RUNTIME_UNAVAILABLE",
      "Could not read the Hugging Face Space runtime",
      502,
    );
  }

  const runtime = await runtimeResponse.json() as Record<string, unknown>;
  const stage = String(runtime.stage || "UNKNOWN").toUpperCase();
  if (stage === "RUNNING") return;
  if (
    ["BUILDING", "RUNNING_BUILDING", "STARTING", "RESTARTING"].includes(stage)
  ) {
    throw new AppError(
      "SPACE_WAKING",
      "The Space is waking up automatically. Please wait and try again shortly",
      503,
      { stage },
    );
  }
  if (["PAUSED", "STOPPED", "SLEEPING"].includes(stage)) {
    const restartResponse = await fetchWithTimeout(
      `https://huggingface.co/api/spaces/${encodeURI(repoId)}/restart`,
      { method: "POST", headers },
      20_000,
    );
    if (restartResponse.status === 401 || restartResponse.status === 403) {
      throw new AppError(
        "HF_PERMISSION_DENIED",
        "Only the Space owner can restart this paused Space",
        403,
      );
    }
    if (!restartResponse.ok && restartResponse.status !== 409) {
      throw new AppError(
        "SPACE_RESTART_FAILED",
        "Hugging Face could not restart the paused Space",
        502,
      );
    }
    throw new AppError(
      "SPACE_WAKING",
      "The paused Space was restarted automatically. It will be ready shortly",
      503,
      { stage },
    );
  }
  if (stage.includes("ERROR") || stage.includes("FAILED")) {
    throw new AppError(
      "SPACE_RUNTIME_FAILED",
      `Hugging Face Space runtime is ${stage}`,
      409,
    );
  }
  throw new AppError(
    "SPACE_NOT_READY",
    `Hugging Face Space is not ready (${stage})`,
    503,
    { stage },
  );
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const fallbackRequestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();

  try {
    assertPost(req);
    const ctx = await authenticate(req);
    const body = await readJson(req, 12 * 1024 * 1024);
    const serverId = String(body.server_id || "");
    const action = String(body.action || "");
    if (!UUID.test(serverId) || !endpoints[action]) {
      throw new AppError(
        "INVALID_REQUEST",
        "Server ID or action is invalid",
        400,
      );
    }

    const bucket = uploadChunkActions.has(action)
      ? "agent.upload_chunk"
      : backupActions.has(action)
      ? "agent.backup"
      : installerActions.has(action)
      ? "agent.install"
      : powerActions.has(action)
      ? "agent.power"
      : readActions.has(action)
      ? "agent.read"
      : "agent.write";
    await rateLimit(
      ctx.admin,
      ctx.user.id,
      bucket,
      uploadChunkActions.has(action)
        ? 240
        : backupActions.has(action)
        ? 8
        : installerActions.has(action)
        ? 15
        : powerActions.has(action)
        ? 15
        : readActions.has(action)
        ? 120
        : 40,
      backupActions.has(action) || installerActions.has(action) ? 3600 : 60,
    );

    const { data: server, error: serverError } = await ctx.admin.from("servers")
      .select("id,owner_id,hf_space_id,minecraft_version").eq("id", serverId)
      .maybeSingle();
    if (serverError) {
      throw new AppError("DATABASE_ERROR", "Could not load the server", 500);
    }
    if (!server) {
      throw new AppError("SERVER_NOT_FOUND", "Server was not found", 404);
    }

    let role: string | null = server.owner_id === ctx.user.id ? "owner" : null;
    if (!role) {
      const { data: member, error: memberError } = await ctx.admin.from(
        "server_members",
      )
        .select("role").eq("server_id", serverId).eq("user_id", ctx.user.id)
        .maybeSingle();
      if (memberError) {
        throw new AppError(
          "DATABASE_ERROR",
          "Could not verify server access",
          500,
        );
      }
      role = member?.role || null;
    }
    if (!role) {
      throw new AppError("SERVER_NOT_FOUND", "Server was not found", 404);
    }
    if (!allowed[role]?.has(action)) {
      throw new AppError(
        "PERMISSION_DENIED",
        "Your server role cannot perform this action",
        403,
      );
    }

    let input: unknown[] = [];
    let auditDetails: Record<string, unknown> = {};
    if (action === "command") {
      const command = text(body.command, 512, "command").trim().replace(
        /^\//,
        "",
      );
      if (!command || /[\r\n\0]/.test(command)) {
        throw new AppError("INVALID_COMMAND", "Command is invalid", 400);
      }
      if (role === "operator" && !safeOperatorCommands.test(command)) {
        throw new AppError(
          "COMMAND_NOT_ALLOWED",
          "This command is not allowed for operators",
          403,
        );
      }
      input = [command];
      auditDetails = { command };
    } else if (
      ["file_list", "file_read", "file_download", "file_delete"].includes(
        action,
      )
    ) {
      const path = safePath(body.path);
      if (action !== "file_list" && !path) {
        throw new AppError("INVALID_PATH", "A file path is required", 400);
      }
      input = [path];
      auditDetails = { path };
    } else if (action === "file_write" || action === "file_write_safe") {
      const path = safePath(body.path);
      const content = text(body.content, 2 * 1024 * 1024, "content");
      if (!path) {
        throw new AppError("INVALID_PATH", "A file path is required", 400);
      }
      input = [path, content];
      auditDetails = {
        path,
        bytes: new TextEncoder().encode(content).length,
        safe_apply: action === "file_write_safe",
      };
    } else if (action === "file_write_safe_status") {
      const jobId = text(body.job_id, 30, "job_id").toLowerCase();
      if (!/^apply_[0-9a-f]{24}$/.test(jobId)) {
        throw new AppError(
          "INVALID_SAFE_APPLY_JOB",
          "Safe Apply job ID is invalid",
          400,
        );
      }
      input = [jobId];
    } else if (action === "file_upload") {
      const path = safePath(body.path);
      const name = text(body.name, 255, "name").trim();
      const data = text(body.data, 11_200_000, "data");
      if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) {
        throw new AppError("INVALID_FILENAME", "Filename is invalid", 400);
      }
      if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
        throw new AppError(
          "INVALID_UPLOAD",
          "Uploaded file data is invalid",
          400,
        );
      }
      input = [path, name, data];
      auditDetails = { path, name, encoded_bytes: data.length };
    } else if (action === "file_upload_init") {
      const path = safePath(body.path);
      const name = text(body.name, 255, "name").trim();
      const totalSize = Number(body.total_size);
      const expectedSha = text(body.sha256, 64, "sha256").toLowerCase();
      if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) {
        throw new AppError("INVALID_FILENAME", "Filename is invalid", 400);
      }
      if (
        !Number.isInteger(totalSize) || totalSize <= 0 ||
        totalSize > 512 * 1024 * 1024
      ) {
        throw new AppError(
          "INVALID_UPLOAD_SIZE",
          "Upload size must be between 1 byte and 512 MB",
          400,
        );
      }
      if (expectedSha && !/^[0-9a-f]{64}$/.test(expectedSha)) {
        throw new AppError(
          "INVALID_CHECKSUM",
          "Expected SHA-256 is invalid",
          400,
        );
      }
      input = [path, name, String(totalSize), expectedSha];
      auditDetails = { path, name, total_size: totalSize };
    } else if (action === "file_upload_chunk") {
      const uploadId = text(body.upload_id, 32, "upload_id").toLowerCase();
      const index = Number(body.chunk_index);
      const data = text(body.data, 4_300_000, "data");
      const chunkSha = text(body.chunk_sha256, 64, "chunk_sha256")
        .toLowerCase();
      if (
        !/^[0-9a-f]{32}$/.test(uploadId) || !Number.isInteger(index) ||
        index < 0
      ) {
        throw new AppError(
          "INVALID_UPLOAD_CHUNK",
          "Upload session or chunk index is invalid",
          400,
        );
      }
      if (
        !data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
        !/^[0-9a-f]{64}$/.test(chunkSha)
      ) {
        throw new AppError(
          "INVALID_UPLOAD_CHUNK",
          "Chunk payload or checksum is invalid",
          400,
        );
      }
      input = [uploadId, String(index), data, chunkSha];
    } else if (
      ["file_upload_status", "file_upload_complete", "file_upload_abort"]
        .includes(action)
    ) {
      const uploadId = text(body.upload_id, 32, "upload_id").toLowerCase();
      if (!/^[0-9a-f]{32}$/.test(uploadId)) {
        throw new AppError(
          "INVALID_UPLOAD_SESSION",
          "Upload session ID is invalid",
          400,
        );
      }
      input = [uploadId];
      auditDetails = { upload_id: uploadId };
    } else if (action === "file_create") {
      const path = safePath(body.path);
      const itemType = body.item_type === "folder"
        ? "folder"
        : body.item_type === "file"
        ? "file"
        : "";
      if (!path || !itemType) {
        throw new AppError(
          "INVALID_INPUT",
          "Path and item type are required",
          400,
        );
      }
      input = [path, itemType];
      auditDetails = { path, item_type: itemType };
    } else if (action === "file_rename") {
      const path = safePath(body.path);
      const newName = text(body.new_name, 255, "new_name").trim();
      if (
        !path || !newName || newName === "." || newName === ".." ||
        /[\\/\0]/.test(newName)
      ) {
        throw new AppError(
          "INVALID_FILENAME",
          "The new filename is invalid",
          400,
        );
      }
      input = [path, newName];
      auditDetails = { path, new_name: newName };
    } else if (action === "backup_list") {
      input = [];
    } else if (action === "backup_status") {
      const jobId = text(body.job_id, 64, "job_id").trim();
      if (!/^job_[0-9a-f]{24}$/.test(jobId)) {
        throw new AppError(
          "INVALID_BACKUP_JOB",
          "Backup job ID is invalid",
          400,
        );
      }
      input = [jobId];
    } else if (action === "backup_create") {
      const label =
        text(body.label, 80, "label").replace(/[\r\n\0]/g, " ").trim() ||
        "Manual backup";
      input = [label];
      auditDetails = { label };
    } else if (action === "backup_delete" || action === "backup_restore") {
      const archive = text(body.path, 180, "path");
      if (!/^backups\/[A-Za-z0-9_.-]+\.tar\.gz$/.test(archive)) {
        throw new AppError(
          "INVALID_BACKUP_PATH",
          "Backup archive path is invalid",
          400,
        );
      }
      input = [archive];
      auditDetails = { archive };
    } else if (action === "plugin_install") {
      const projectId = text(body.project_id, 96, "project_id").trim();
      if (!/^[A-Za-z0-9_-]{2,96}$/.test(projectId)) {
        throw new AppError(
          "INVALID_PROJECT_ID",
          "Modrinth project ID is invalid",
          400,
        );
      }
      const versionsUrl = new URL(
        `https://api.modrinth.com/v2/project/${
          encodeURIComponent(projectId)
        }/version`,
      );
      versionsUrl.searchParams.set(
        "loaders",
        JSON.stringify(["paper", "purpur", "spigot", "bukkit"]),
      );
      versionsUrl.searchParams.set(
        "game_versions",
        JSON.stringify([String(server.minecraft_version || "1.21.1")]),
      );
      const versionsResponse = await fetchWithTimeout(versionsUrl, {
        headers: {
          Accept: "application/json",
          "User-Agent": "SAW-MC-Hosting/2.0",
        },
      }, 15_000);
      if (versionsResponse.status === 404) {
        throw new AppError(
          "PLUGIN_NOT_FOUND",
          "Modrinth plugin was not found",
          404,
        );
      }
      if (!versionsResponse.ok) {
        throw new AppError(
          "MODRINTH_UNAVAILABLE",
          "Modrinth is temporarily unavailable",
          502,
        );
      }
      const versions = await versionsResponse.json();
      const version = Array.isArray(versions) ? versions[0] : null;
      const files = Array.isArray(version?.files) ? version.files : [];
      const file = files.find((item: any) => item.primary) || files[0];
      const fileUrl = String(file?.url || "");
      const filename = String(file?.filename || "");
      const sha512 = String(file?.hashes?.sha512 || "").toLowerCase();
      let downloadHost = "";
      try {
        downloadHost = new URL(fileUrl).hostname;
      } catch { /* rejected below */ }
      if (
        downloadHost !== "cdn.modrinth.com" ||
        !/^[^\\/\0]{1,255}\.jar$/i.test(filename) ||
        !/^[0-9a-f]{128}$/.test(sha512)
      ) {
        throw new AppError(
          "NO_COMPATIBLE_PLUGIN",
          "No verified plugin file is compatible with this Minecraft version",
          409,
        );
      }
      input = [fileUrl, filename, sha512];
      auditDetails = {
        project_id: projectId,
        version_id: version.id,
        filename,
        minecraft_version: server.minecraft_version,
      };
    }

    const { data: connection, error: connectionError } = await ctx.admin.from(
      "hf_connections",
    )
      .select("access_token").eq("user_id", server.owner_id).maybeSingle();
    if (connectionError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not read the server connection",
        500,
      );
    }
    if (!connection) {
      throw new AppError(
        "HF_NOT_CONNECTED",
        "The owner must reconnect Hugging Face",
        409,
      );
    }

    await ensureSpaceAwake(server.hf_space_id, connection.access_token);

    const infoResponse = await fetchWithTimeout(
      `https://huggingface.co/api/spaces/${encodeURI(server.hf_space_id)}`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/json",
        },
      },
      15_000,
    );
    if (infoResponse.status === 404) {
      throw new AppError(
        "SPACE_NOT_FOUND",
        "The Hugging Face Space no longer exists",
        404,
      );
    }
    if (infoResponse.status === 401 || infoResponse.status === 403) {
      throw new AppError(
        "HF_PERMISSION_DENIED",
        "The owner must reconnect Hugging Face",
        403,
      );
    }
    if (!infoResponse.ok) {
      throw new AppError(
        "HF_UNAVAILABLE",
        "Hugging Face is temporarily unavailable",
        502,
      );
    }

    const info = await infoResponse.json() as Record<string, unknown>;
    const fallbackHost = `${
      server.hf_space_id.toLowerCase().replace(/_/g, "-").replace("/", "-")
    }.hf.space`;
    const host = String(info.host || fallbackHost).replace(/^https?:\/\//, "")
      .replace(/\/$/, "").toLowerCase();
    if (!/^[a-z0-9.-]+\.hf\.space$/.test(host)) {
      throw new AppError(
        "INVALID_AGENT_HOST",
        "Hugging Face returned an invalid Agent address",
        502,
      );
    }

    const output = await gradioCall(
      host,
      endpoints[action],
      input,
      connection.access_token,
    );
    if (auditedActions.has(action)) {
      const { error: auditError } = await ctx.admin.from("audit_logs").insert({
        server_id: serverId,
        user_id: ctx.user.id,
        action: `agent.${action}`,
        details: { ...auditDetails, role, request_id: ctx.requestId },
      });
      if (auditError) {
        console.error(
          `[${ctx.requestId}] Audit insert failed: ${auditError.message}`,
        );
      }
    }

    return jsonResponse(
      { ok: true, result: output, request_id: ctx.requestId },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackRequestId);
  }
});
