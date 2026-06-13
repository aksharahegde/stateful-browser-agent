import { describe, it, expect } from "vitest";
import { isRateLimited, retryAfterSeconds, runCooldownMs } from "../src/rateLimit";

describe("runCooldownMs", () => {
  it("defaults to 10 seconds", () => {
    expect(runCooldownMs({})).toBe(10_000);
  });

  it("reads AGENT_RUN_COOLDOWN_MS from env", () => {
    expect(runCooldownMs({ AGENT_RUN_COOLDOWN_MS: "5000" })).toBe(5000);
    expect(runCooldownMs({ AGENT_RUN_COOLDOWN_MS: "invalid" })).toBe(10_000);
  });
});

describe("isRateLimited", () => {
  it("blocks runs inside the cooldown window", () => {
    const now = 1_000_000;
    expect(isRateLimited(now - 5_000, 10_000, now)).toBe(true);
    expect(isRateLimited(now - 10_000, 10_000, now)).toBe(false);
  });

  it("never limits when cooldown is zero", () => {
    expect(isRateLimited(Date.now(), 0)).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  it("returns remaining seconds rounded up", () => {
    expect(retryAfterSeconds(1_000, 10_000, 6_500)).toBe(5);
  });
});
