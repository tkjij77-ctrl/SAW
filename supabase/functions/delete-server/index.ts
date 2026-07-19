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
const REPO_ID = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function deleteHfRepo(
  repoId: string,
  type: "space" | "dataset",
  token: string,
) {
  if (!REPO_ID.test(repoId)) {
    throw new AppError(
      "INVALID_REPO_ID",
      "Stored Hugging Face repository ID is invalid",
      500,
    );
  }
  const [organization, name] = repoId.split("/");
  const response = await fetchWithTimeout(
    "https://huggingface.co/api/repos/delete",
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ name, organization, type }),
    },
    20_000,
  );
  if (response.status === 404) return;
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      "HF_PERMISSION_DENIED",
      `Hugging Face refused to delete the ${type}`,
      403,
    );
  }
  if (!response.ok) {
    throw new AppError(
      "HF_DELETE_FAILED",
      `Could not delete the Hugging Face ${type}`,
      502,
    );
  }
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const fallbackId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();
  try {
    assertPost(req);
    const ctx = await authenticate(req);
    await rateLimit(ctx.admin, ctx.user.id, "server.delete", 5, 3600);
    const body = await readJson(req, 8192);
    const serverId = String(body.server_id || "");
    const confirmation = String(body.confirmation || "").trim();
    const deleteSpace = body.delete_space !== false;
    const deleteDataset = body.delete_dataset === true;
    if (!UUID.test(serverId)) {
      throw new AppError(
        "INVALID_SERVER_ID",
        "A valid server ID is required",
        400,
      );
    }

    const { data: server, error: serverError } = await ctx.admin.from("servers")
      .select("id,owner_id,name,hf_space_id,dataset_repo_id")
      .eq("id", serverId).eq("owner_id", ctx.user.id).maybeSingle();
    if (serverError) {
      throw new AppError("DATABASE_ERROR", "Could not read the server", 500);
    }
    if (!server) {
      throw new AppError(
        "SERVER_NOT_FOUND",
        "Only the server owner can delete it",
        404,
      );
    }
    if (confirmation !== server.name) {
      throw new AppError(
        "CONFIRMATION_MISMATCH",
        "Type the exact server name to confirm deletion",
        400,
      );
    }

    if (deleteSpace || deleteDataset) {
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
          "Reconnect Hugging Face before deleting remote resources",
          409,
        );
      }
      if (deleteSpace) {
        await deleteHfRepo(
          server.hf_space_id,
          "space",
          connection.access_token,
        );
      }
      if (deleteDataset && server.dataset_repo_id) {
        await deleteHfRepo(
          server.dataset_repo_id,
          "dataset",
          connection.access_token,
        );
      }
    }

    const { error: deleteError } = await ctx.admin.from("servers").delete()
      .eq("id", server.id).eq("owner_id", ctx.user.id);
    if (deleteError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Remote resources were handled but the SAW record could not be deleted",
        500,
      );
    }

    return jsonResponse(
      {
        ok: true,
        deleted: {
          server_id: server.id,
          space: deleteSpace,
          dataset: deleteDataset,
        },
        request_id: ctx.requestId,
      },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackId);
  }
});
