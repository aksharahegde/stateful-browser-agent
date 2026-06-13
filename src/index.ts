export { AgentSession } from "./agent";

const HTML = `<!DOCTYPE html><html><body><p>Loading...</p></body></html>`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const id = env.AGENT_SESSION.idFromName("demo-session");
    const stub = env.AGENT_SESSION.get(id);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const doResponse = await stub.fetch(new Request("https://agent/run", {
        method: "POST",
        body: request.body,
        headers: { "Content-Type": "application/json" },
      }));
      const responseHeaders = new Headers(doResponse.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      return new Response(doResponse.body, {
        status: doResponse.status,
        headers: responseHeaders,
      });
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const doResponse = await stub.fetch(new Request("https://agent/status"));
      const responseHeaders = new Headers(doResponse.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        responseHeaders.set(key, value);
      }
      return new Response(doResponse.body, {
        status: doResponse.status,
        headers: responseHeaders,
      });
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
