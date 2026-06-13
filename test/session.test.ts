import { describe, it, expect } from "vitest";
import { sessionIdFromRequest } from "../src/session";

describe("sessionIdFromRequest", () => {
  it("hashes bearer tokens into stable session IDs", async () => {
    const req = new Request("https://worker.example/run", {
      headers: { Authorization: "Bearer secret-token" },
    });
    const a = await sessionIdFromRequest(req, {});
    const b = await sessionIdFromRequest(req, {});
    expect(a).toBe(b);
    expect(a).not.toBe("demo-session");
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it("uses X-Session-Id when bearer token is absent", async () => {
    const req = new Request("https://worker.example/run", {
      headers: { "X-Session-Id": "user-123" },
    });
    expect(await sessionIdFromRequest(req, {})).toBe("user-123");
  });

  it("falls back to demo-session for anonymous requests", async () => {
    const req = new Request("https://worker.example/run");
    expect(await sessionIdFromRequest(req, {})).toBe("demo-session");
  });

  it("rejects invalid X-Session-Id values", async () => {
    const req = new Request("https://worker.example/run", {
      headers: { "X-Session-Id": "../escape" },
    });
    expect(await sessionIdFromRequest(req, {})).toBe("demo-session");
  });
});
