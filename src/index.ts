export { AgentSession } from "./agent";

const HTML = `<!DOCTYPE html><html><body><p>Loading...</p></body></html>`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function withCors(doResponse: Response): Response {
  const headers = new Headers(doResponse.headers);
  for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
  return new Response(doResponse.body, { status: doResponse.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName("demo-session"));

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, { headers: { ...corsHeaders, "Content-Type": "text/html" } });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      return withCors(await stub.fetch(new Request("https://agent/run", {
        method: "POST",
        body: request.body,
        headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
      })));
    }

    if (request.method === "GET" && url.pathname === "/status") {
      return withCors(await stub.fetch(new Request("https://agent/status")));
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
