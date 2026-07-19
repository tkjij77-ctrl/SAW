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
  const fallbackId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();
  try {
    assertPost(req);
    const ctx = await authenticate(req);
    await rateLimit(ctx.admin, ctx.user.id, "account.delete", 3, 86400);
    const body = await readJson(req, 4096);
    if (body.confirmation !== "DELETE") {
      throw new AppError(
        "CONFIRMATION_MISMATCH",
        "Type DELETE to confirm account deletion",
        400,
      );
    }

    const { count, error: countError } = await ctx.admin.from("servers")
      .select("id", { count: "exact", head: true }).eq("owner_id", ctx.user.id);
    if (countError) {
      throw new AppError(
        "DATABASE_ERROR",
        "Could not verify owned servers",
        500,
      );
    }
    if ((count || 0) > 0) {
      throw new AppError(
        "OWNED_SERVERS_EXIST",
        `Delete your ${count} owned server(s) before deleting the account`,
        409,
      );
    }

    const { error } = await ctx.admin.auth.admin.deleteUser(ctx.user.id);
    if (error) {
      throw new AppError(
        "ACCOUNT_DELETE_FAILED",
        "Could not delete the account",
        500,
      );
    }
    return jsonResponse(
      { ok: true, deleted: true, request_id: ctx.requestId },
      200,
      req,
      ctx.requestId,
    );
  } catch (error) {
    return errorResponse(error, req, fallbackId);
  }
});
