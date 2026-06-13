const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
]);

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^::1$/,
  /^::$/,
  /^0:0:0:0:0:0:0:1$/,
  /^::ffff:/,
  /^fc00:/,
  /^fd[0-9a-f]{2}:/i,
];

// Blocks RFC1918, loopback, link-local, cloud metadata, and common SSRF bypasses.
// NOTE(production): hostname-regex checks can be bypassed via DNS rebinding. Resolve
// hostnames via DoH and validate every returned IP before navigation.
export function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".internal")) return false;
  if (/^\d+$/.test(host)) return false;

  return !PRIVATE_HOST_PATTERNS.some((re) => re.test(host));
}

export function unsafeUrlMessage(url: string, context: string): string {
  return `${context}: unsafe URL ${url}`;
}
