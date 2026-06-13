export type RateLimitEnv = { AGENT_RUN_COOLDOWN_MS?: string };

const DEFAULT_COOLDOWN_MS = 10_000;

export function runCooldownMs(env: RateLimitEnv): number {
  const parsed = Number(env.AGENT_RUN_COOLDOWN_MS);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_COOLDOWN_MS;
  return parsed;
}

export function isRateLimited(lastRunAt: number | undefined, cooldownMs: number, now = Date.now()): boolean {
  if (cooldownMs === 0 || lastRunAt === undefined) return false;
  return now - lastRunAt < cooldownMs;
}

export function retryAfterSeconds(lastRunAt: number, cooldownMs: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((cooldownMs - (now - lastRunAt)) / 1000));
}
