import { describe, it, expect } from "vitest";
import { resolveCorsHeaders } from "../src/cors";

describe("resolveCorsHeaders", () => {
  it("allows all origins when ALLOWED_ORIGINS is unset", () => {
    const headers = resolveCorsHeaders(new Request("https://worker.example/run"), {});
    expect(headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(headers["Access-Control-Allow-Headers"]).toContain("Authorization");
  });

  it("reflects configured origins", () => {
    const req = new Request("https://worker.example/run", {
      headers: { Origin: "https://app.example.com" },
    });
    const headers = resolveCorsHeaders(req, {
      ALLOWED_ORIGINS: "https://app.example.com,https://admin.example.com",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://app.example.com");
    expect(headers.Vary).toBe("Origin");
  });

  it("omits allow-origin for disallowed cross-origin requests", () => {
    const req = new Request("https://worker.example/run", {
      headers: { Origin: "https://evil.example.com" },
    });
    const headers = resolveCorsHeaders(req, {
      ALLOWED_ORIGINS: "https://app.example.com",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
