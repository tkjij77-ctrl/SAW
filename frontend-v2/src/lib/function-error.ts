export class EdgeFunctionError extends Error {
  constructor(
    message: string,
    public code = "EDGE_FUNCTION_ERROR",
    public status?: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = "EdgeFunctionError";
  }
}

export async function getFunctionError(error: unknown): Promise<EdgeFunctionError> {
  const candidate = error as { message?: string; context?: Response };
  try {
    const response = candidate.context?.clone();
    const body = await response?.json();
    return new EdgeFunctionError(
      body?.error ?? body?.message ?? candidate.message ?? "Edge Function failed",
      body?.code ?? "EDGE_FUNCTION_ERROR",
      response?.status,
      body?.request_id,
    );
  } catch {
    return new EdgeFunctionError(candidate?.message ?? String(error));
  }
}
