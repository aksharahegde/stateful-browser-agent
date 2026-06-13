type SessionEnv = { AGENT_API_KEY?: string };

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToHex(digest).slice(0, 32);
}

export async function sessionIdFromRequest(
  request: Request,
  _env: SessionEnv
): Promise<string> {
  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ") && auth.length > 7) {
    return hashToken(auth.slice(7));
  }

  const headerSession = request.headers.get("X-Session-Id");
  if (headerSession && SESSION_ID_PATTERN.test(headerSession)) {
    return headerSession;
  }

  return "demo-session";
}
