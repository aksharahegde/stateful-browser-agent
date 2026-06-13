import { describe, it, expect } from "vitest";
import worker from "../src/index";

const sseBody = `data: {"type":"done","summary":"test summary"}\n\n`;

const mockEnv = {
  AGENT_SESSION: {
    idFromName: (_: string) => "mock-id" as unknown as DurableObjectId,
    get: (_: unknown) => ({
      fetch: async (req: Request): Promise<Response> => {
        const path = new URL(req.url).pathname;
        if (path === "/run") {
          return new Response(sseBody, {
            headers: { "Content-Type": "text/event-stream" },
          });
        }
        if (path === "/status") {
          return Response.json({ goal: "test", steps: [], status: "idle" });
        }
        return new Response("Not Found", { status: 404 });
      },
    }),
  },
} as unknown as Env;

describe("Worker routing", () => {
  it("OPTIONS /* returns 204 with CORS headers", async () => {
    const req = new Request("https://worker.example/run", { method: "OPTIONS" });
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("GET / returns 200 with text/html containing page title", async () => {
    const req = new Request("https://worker.example/");
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Stateful Browser Agent");
  });

  it("POST /run proxies to DO and returns SSE with CORS", async () => {
    const req = new Request("https://worker.example/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal: "test goal" }),
    });
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.text();
    expect(body).toContain("done");
  });

  it("GET /status proxies to DO and returns JSON with CORS", async () => {
    const req = new Request("https://worker.example/status");
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const data = await res.json() as { status: string };
    expect(data.status).toBe("idle");
  });

  it("GET /unknown returns 404 with CORS", async () => {
    const req = new Request("https://worker.example/unknown");
    const res = await worker.fetch(req, mockEnv);
    expect(res.status).toBe(404);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
