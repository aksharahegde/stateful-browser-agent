type AuthEnv = { AGENT_API_KEY?: string };

export function requireApiKey(
  request: Request,
  env: AuthEnv,
  corsHeaders: Record<string, string>
): Response | null {
  const key = env.AGENT_API_KEY;
  if (!key) return null;

  const auth = request.headers.get("Authorization");
  if (auth !== `Bearer ${key}`) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  return null;
}
