import {
  AppError,
  assertPost,
  authenticate,
  errorResponse,
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
    await rateLimit(ctx.admin, ctx.user.id, "hf.unlink", 10, 3600);
    await readJson(req, 1024); // Require a valid JSON object, normally {}.

    const { error } = await ctx.admin.from("hf_connections").delete().eq(
      "user_id",
      ctx.user.id,
    );
    if (error) {
      throw new AppError(
        "CONNECTION_DELETE_FAILED",
        "Could not remove the Hugging Face connection",
        500,
      );
    }

    return jsonResponse(
      { ok: true, request_id: ctx.requestId },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackRequestId);
  }
});
