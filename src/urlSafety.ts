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

type DnsJsonAnswer = { type: number; data: string };
type DnsJsonResponse = { Status?: number; Answer?: DnsJsonAnswer[] };

export type UrlSafetyOptions = {
  allowedHostSuffixes?: string;
  dohFetch?: typeof fetch;
};

function parseAllowedHostSuffixes(raw?: string): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedHost(hostname: string, allowedHostSuffixes?: string): boolean {
  const allowed = parseAllowedHostSuffixes(allowedHostSuffixes);
  if (allowed.length === 0) return true;
  const host = hostname.toLowerCase();
  return allowed.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (mapped.includes(".")) return isPrivateIp(mapped);
  }
  return PRIVATE_HOST_PATTERNS.some((re) => re.test(normalized));
}

function isIpLiteral(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

// Synchronous hostname and literal-IP checks before navigation.
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

export async function resolveHostIps(
  hostname: string,
  dohFetch: typeof fetch = fetch
): Promise<string[]> {
  const ips: string[] = [];
  for (const type of [1, 28] as const) {
    const res = await dohFetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
      { headers: { Accept: "application/dns-json" } }
    );
    if (!res.ok) continue;
    const data = (await res.json()) as DnsJsonResponse;
    if (data.Status !== 0) continue;
    for (const answer of data.Answer ?? []) {
      if (answer.type === 1 || answer.type === 28) ips.push(answer.data);
    }
  }
  return ips;
}

export async function validateSafeUrl(
  raw: string,
  options: UrlSafetyOptions = {}
): Promise<boolean> {
  if (!isSafeUrl(raw)) return false;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!isAllowedHost(host, options.allowedHostSuffixes)) return false;

  if (isIpLiteral(host)) return true;

  const dohFetch = options.dohFetch ?? fetch;
  const ips = await resolveHostIps(host, dohFetch);
  if (ips.length === 0) return false;
  return ips.every((ip) => !isPrivateIp(ip));
}

export function unsafeUrlMessage(url: string, context: string): string {
  return `${context}: unsafe URL ${url}`;
}
