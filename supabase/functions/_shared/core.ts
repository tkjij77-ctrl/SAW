import {
  createClient,
  type SupabaseClient,
  type User,
} from "npm:@supabase/supabase-js@2.57.4";

const DEFAULT_ORIGINS = ["https://tkjij77-ctrl.github.io"];
const ALLOWED_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-request-id";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface RequestContext {
  requestId: string;
  origin: string | null;
  user: User;
  admin: SupabaseClient;
  authHeader: string;
}

function allowedOrigins(): string[] {
  const configured = (Deno.env.get("ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ORIGINS;
}

function validateOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (origin && !allowedOrigins().includes(origin)) {
    throw new AppError(
      "ORIGIN_NOT_ALLOWED",
      "Request origin is not allowed",
      403,
    );
  }
  return origin;
}

export function corsHeaders(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin || DEFAULT_ORIGINS[0],
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  try {
    const origin = validateOrigin(req);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  } catch (error) {
    return errorResponse(error, req, crypto.randomUUID());
  }
}

export function assertPost(req: Request): void {
  if (req.method !== "POST") {
    throw new AppError(
      "METHOD_NOT_ALLOWED",
      "Only POST requests are accepted",
      405,
    );
  }
}

export function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  req: Request,
  requestId: string,
): Response {
  let origin: string | null = null;
  try {
    origin = validateOrigin(req);
  } catch { /* handled before successful responses */ }
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(origin), "X-Request-Id": requestId },
  });
}

export function errorResponse(
  error: unknown,
  req: Request,
  requestId: string,
): Response {
  const known = error instanceof AppError;
  const status = known ? error.status : 500;
  const code = known ? error.code : "INTERNAL_ERROR";
  const message = known ? error.message : "An unexpected server error occurred";
  if (!known) {
    console.error(
      `[${requestId}]`,
      error instanceof Error ? error.message : String(error),
    );
  }
  return jsonResponse(
    { ok: false, error: message, code, request_id: requestId },
    status,
    req,
    requestId,
  );
}

export async function authenticate(req: Request): Promise<RequestContext> {
  const origin = validateOrigin(req);
  const requestId = req.headers.get("X-Request-Id")?.slice(0, 100) ||
    crypto.randomUUID();
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new AppError("AUTH_REQUIRED", "Login required", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    throw new AppError(
      "SERVER_MISCONFIGURED",
      "Backend configuration is incomplete",
      500,
    );
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await userClient.auth.getUser(jwt);
  if (error || !user) {
    throw new AppError(
      "INVALID_SESSION",
      "Your session is invalid or expired",
      401,
    );
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { requestId, origin, user, admin, authHeader };
}

export async function readJson(
  req: Request,
  maxBytes = 9 * 1024 * 1024,
): Promise<Record<string, unknown>> {
  const length = Number(req.headers.get("content-length") || 0);
  if (length > maxBytes) {
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      "Request payload is too large",
      413,
    );
  }
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new AppError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(
      "INVALID_BODY",
      "Request body must be a JSON object",
      400,
    );
  }
  return value as Record<string, unknown>;
}

export async function rateLimit(
  admin: SupabaseClient,
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_user: userId,
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed:", error.message);
    throw new AppError(
      "RATE_LIMIT_UNAVAILABLE",
      "Request protection is temporarily unavailable",
      503,
    );
  }
  if (!data) {
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Please wait and try again",
      429,
    );
  }
}

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = 20_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AppError(
        "UPSTREAM_TIMEOUT",
        "The external service took too long to respond",
        504,
      );
    }
    throw new AppError(
      "UPSTREAM_UNAVAILABLE",
      "The external service is temporarily unavailable",
      502,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function safeMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return "An unexpected provisioning error occurred";
}
