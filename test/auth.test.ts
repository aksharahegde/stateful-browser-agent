import { describe, it, expect } from "vitest";
import { requireApiKey } from "../src/auth";

const corsHeaders = { "Access-Control-Allow-Origin": "*" };

describe("requireApiKey", () => {
  it("allows requests when AGENT_API_KEY is not configured", () => {
    const req = new Request("https://worker.example/run", { method: "POST" });
    expect(requireApiKey(req, {}, corsHeaders)).toBeNull();
  });

  it("rejects requests without Authorization when key is configured", () => {
    const req = new Request("https://worker.example/run", { method: "POST" });
    const res = requireApiKey(req, { AGENT_API_KEY: "secret" }, corsHeaders);
    expect(res?.status).toBe(401);
  });

  it("rejects requests with wrong bearer token", () => {
    const req = new Request("https://worker.example/run", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    const res = requireApiKey(req, { AGENT_API_KEY: "secret" }, corsHeaders);
    expect(res?.status).toBe(401);
  });

  it("allows requests with matching bearer token", () => {
    const req = new Request("https://worker.example/run", {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
    });
    expect(requireApiKey(req, { AGENT_API_KEY: "secret" }, corsHeaders)).toBeNull();
  });
});
