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
    await rateLimit(ctx.admin, ctx.user.id, "hf.link", 10, 3600);
    const body = await readJson(req, 16_384);
    const token = body.hf_access_token;
    if (typeof token !== "string" || token.length < 10 || token.length > 4096) {
      throw new AppError(
        "INVALID_HF_TOKEN",
        "A valid Hugging Face access token is required",
        400,
      );
    }

    const profileResponse = await fetchWithTimeout(
      "https://huggingface.co/oauth/userinfo",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      15_000,
    );
    if (!profileResponse.ok) {
      throw new AppError(
        "HF_AUTH_FAILED",
        "Hugging Face rejected the connection",
        401,
      );
    }

    const hf = await profileResponse.json() as Record<string, unknown>;
    const username = String(
      hf.preferred_username || hf.name || hf.nickname || "",
    ).trim();
    if (!/^[A-Za-z0-9_.-]{1,96}$/.test(username)) {
      throw new AppError(
        "HF_PROFILE_INVALID",
        "Hugging Face did not return a valid username",
        502,
      );
    }

    const { error } = await ctx.admin.from("hf_connections").upsert({
      user_id: ctx.user.id,
      hf_username: username,
      access_token: token,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      throw new AppError(
        "CONNECTION_SAVE_FAILED",
        "Could not securely save the Hugging Face connection",
        500,
      );
    }

    // Refresh the write-only backup secret for existing auto-provisioned Spaces.
    // Failures are reported but do not discard a valid account connection.
    const { data: servers } = await ctx.admin.from("servers")
      .select("hf_space_id").eq("owner_id", ctx.user.id).limit(25);
    let secretsUpdated = 0;
    const secretsFailed: string[] = [];
    for (const server of servers || []) {
      if (
        !String(server.hf_space_id).toLowerCase().startsWith(
          `${username.toLowerCase()}/`,
        )
      ) continue;
      try {
        const secretResponse = await fetchWithTimeout(
          `https://huggingface.co/api/spaces/${
            encodeURI(server.hf_space_id)
          }/secrets`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ key: "HF_TOKEN", value: token }),
          },
          15_000,
        );
        if (secretResponse.ok) secretsUpdated += 1;
        else secretsFailed.push(server.hf_space_id);
      } catch {
        secretsFailed.push(server.hf_space_id);
      }
    }

    return jsonResponse(
      {
        ok: true,
        hf_username: username,
        backup_secrets_updated: secretsUpdated,
        backup_secrets_failed: secretsFailed,
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
