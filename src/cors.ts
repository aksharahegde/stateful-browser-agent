export type CorsEnv = { ALLOWED_ORIGINS?: string };

export function resolveCorsHeaders(
  request: Request,
  env: CorsEnv
): Record<string, string> {
  const base: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Session-Id",
  };

  const allowed =
    env.ALLOWED_ORIGINS?.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  if (allowed.length === 0) {
    return { ...base, "Access-Control-Allow-Origin": "*" };
  }

  const origin = request.headers.get("Origin");
  if (origin && allowed.includes(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin, Vary: "Origin" };
  }

  return base;
}
