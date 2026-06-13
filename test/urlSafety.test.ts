import { describe, it, expect, vi } from "vitest";
import {
  isAllowedHost,
  isPrivateIp,
  isSafeUrl,
  validateSafeUrl,
} from "../src/urlSafety";

describe("isPrivateIp", () => {
  it("detects private IPv4 addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("192.168.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("allows public IPv4 addresses", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("1.1.1.1")).toBe(false);
  });

  it("detects IPv4-mapped loopback", () => {
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
  });
});

describe("isAllowedHost", () => {
  it("allows all hosts when allowlist is empty", () => {
    expect(isAllowedHost("example.com")).toBe(true);
  });

  it("restricts hosts to configured suffixes", () => {
    const allowlist = "cloudflare.com,example.com";
    expect(isAllowedHost("developers.cloudflare.com", allowlist)).toBe(true);
    expect(isAllowedHost("example.com", allowlist)).toBe(true);
    expect(isAllowedHost("evil.com", allowlist)).toBe(false);
  });
});

describe("validateSafeUrl", () => {
  it("blocks hostnames that resolve to private IPs", async () => {
    const dohFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: "127.0.0.1" }],
      }))
    );

    expect(await validateSafeUrl("https://localtest.me/", { dohFetch })).toBe(false);
    expect(dohFetch).toHaveBeenCalled();
  });

  it("allows hostnames that resolve to public IPs", async () => {
    const dohFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      const type = url.includes("type=28") ? 28 : 1;
      const data = type === 28 ? "2606:2800:220:1:248:1893:25c8:1946" : "93.184.216.34";
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type, data }],
      }));
    });

    expect(await validateSafeUrl("https://example.com/", { dohFetch })).toBe(true);
  });

  it("blocks hosts outside the allowlist before DNS lookup", async () => {
    const dohFetch = vi.fn();
    expect(await validateSafeUrl("https://evil.com/", {
      allowedHostSuffixes: "example.com",
      dohFetch,
    })).toBe(false);
    expect(dohFetch).not.toHaveBeenCalled();
  });

  it("rejects hostnames with no DNS answers", async () => {
    const dohFetch = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ Status: 0, Answer: [] }))
    );
    expect(await validateSafeUrl("https://missing.example/", { dohFetch })).toBe(false);
  });

  it("preserves synchronous isSafeUrl failures", async () => {
    expect(await validateSafeUrl("http://example.com/")).toBe(false);
    expect(isSafeUrl("http://example.com/")).toBe(false);
  });
});
