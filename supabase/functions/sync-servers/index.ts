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

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  const fallbackRequestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();

  try {
    assertPost(req);
    const ctx = await authenticate(req);
    await readJson(req, 1024);
    await rateLimit(ctx.admin, ctx.user.id, "servers.sync", 12, 60);

    const { data: connection, error: connectionError } = await ctx.admin
      .from("hf_connections").select("access_token").eq("user_id", ctx.user.id)
      .maybeSingle();
    if (connectionError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not read the Hugging Face connection",
        500,
      );
    }
    if (!connection) {
      return jsonResponse(
        {
          ok: true,
          removed: [],
          inaccessible: [],
          warning: "Hugging Face is not connected",
          request_id: ctx.requestId,
        },
        200,
        req,
        ctx.requestId,
      );
    }

    const { data: servers, error: serversError } = await ctx.admin
      .from("servers").select("id,hf_space_id").eq("owner_id", ctx.user.id)
      .limit(100);
    if (serversError) {
      throw new AppError("DATABASE_ERROR", "Could not load servers", 500);
    }

    const removed: string[] = [];
    const inaccessible: string[] = [];
    const unavailable: string[] = [];

    // Small batches avoid overwhelming Hugging Face and the Edge runtime.
    for (let offset = 0; offset < (servers || []).length; offset += 5) {
      const batch = (servers || []).slice(offset, offset + 5);
      const results = await Promise.all(batch.map(async (server) => {
        try {
          const result = await fetchWithTimeout(
            `https://huggingface.co/api/spaces/${
              encodeURI(server.hf_space_id)
            }`,
            {
              headers: {
                Authorization: `Bearer ${connection.access_token}`,
                Accept: "application/json",
              },
            },
            12_000,
          );
          return { server, status: result.status };
        } catch {
          return { server, status: 0 };
        }
      }));

      for (const { server, status } of results) {
        if (status === 404) {
          const { error } = await ctx.admin.from("servers").delete()
            .eq("id", server.id).eq("owner_id", ctx.user.id);
          if (!error) removed.push(server.id);
          else unavailable.push(server.id);
        } else if (status === 401 || status === 403) {
          inaccessible.push(server.id);
        } else if (status === 0 || status >= 500) {
          unavailable.push(server.id);
        }
      }
    }

    return jsonResponse(
      {
        ok: true,
        removed,
        inaccessible,
        unavailable,
        request_id: ctx.requestId,
      },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackRequestId);
  }
});
