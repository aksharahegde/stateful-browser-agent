export { AgentSession } from "./agent";
import { requireApiKey } from "./auth";

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Stateful Browser Agent</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0d1117; color: #c9d1d9; font-family: 'Courier New', monospace; padding: 20px; }
    h1 { color: #00ff41; margin-bottom: 20px; font-size: 1.4em; }
    textarea { width: 100%; background: #161b22; color: #c9d1d9; border: 1px solid #30363d; padding: 10px; font-family: inherit; font-size: 0.9em; resize: vertical; min-height: 80px; border-radius: 4px; }
    button { margin-top: 10px; background: #238636; color: white; border: none; padding: 8px 20px; cursor: pointer; font-family: inherit; border-radius: 4px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-left: 12px; font-size: 0.8em; color: #8b949e; }
    #log { margin-top: 16px; background: #0d1117; border: 1px solid #30363d; padding: 12px; height: 500px; overflow-y: auto; white-space: pre-wrap; word-break: break-word; font-size: 0.85em; line-height: 1.5; color: #00ff41; }
    .error { color: #ff4444; }
  </style>
</head>
<body>
  <h1>Stateful Browser Agent</h1>

  <textarea id="goal">Go to the Cloudflare Browser Run documentation and summarize the key capabilities for building AI agents, including any mentioned limitations.</textarea>

  <div>
    <button id="runBtn" onclick="runAgent()">Run</button>
    <span id="status">idle</span>
  </div>

  <pre id="log"></pre>

  <script>
    function setStatus(text) {
      document.getElementById("status").textContent = text;
    }

    function appendLog(text, isError) {
      const log = document.getElementById("log");
      if (isError) {
        const span = document.createElement("span");
        span.className = "error";
        span.textContent = text + "\\n";
        log.appendChild(span);
      } else {
        log.appendChild(document.createTextNode(text + "\\n"));
      }
      log.scrollTop = log.scrollHeight;
    }

    function formatEvent(data) {
      switch (data.type) {
        case "start":
          return "▶ Starting: " + data.goal;
        case "plan":
          return "📍 Starting URL: " + data.url;
        case "launching":
          return "🌐 Launching browser...";
        case "step":
          return "[Step " + data.step + "] navigate → " + data.url;
        case "observe":
          return "  ↳ Extracted " + data.length + " chars from " + data.url;
        case "think":
          return "  🤔 Decision: " + data.action + " " + (data.next_url || "");
        case "done":
          return "\\n✅ DONE\\n" + data.summary;
        case "error":
          return "❌ ERROR: " + data.message;
        default:
          return JSON.stringify(data);
      }
    }

    async function runAgent() {
      const goalEl = document.getElementById("goal");
      const runBtn = document.getElementById("runBtn");
      const goal = goalEl.value.trim();

      if (!goal) return;

      goalEl.disabled = true;
      runBtn.disabled = true;
      document.getElementById("log").textContent = "";
      setStatus("running");

      try {
        const response = await fetch("/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal }),
        });

        if (!response.ok) {
          appendLog("❌ ERROR: HTTP " + response.status + " " + response.statusText, true);
          setStatus("error");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                const text = formatEvent(data);
                const isError = data.type === "error";
                appendLog(text, isError);
              } catch (e) {
                appendLog(line.slice(6), false);
              }
            }
          }
        }

        setStatus("done");
      } catch (err) {
        appendLog("❌ ERROR: " + err.message, true);
        setStatus("error");
      } finally {
        goalEl.disabled = false;
        runBtn.disabled = false;
      }
    }
  </script>
</body>
</html>`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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

    // TODO(production): derive session ID from an authenticated principal rather than a fixed name.
    const stub = env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName("demo-session"));

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(HTML, { headers: { ...corsHeaders, "Content-Type": "text/html" } });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const authFailure = requireApiKey(request, env, corsHeaders);
      if (authFailure) return authFailure;

      return withCors(await stub.fetch(new Request("https://agent/run", {
        method: "POST",
        body: request.body,
        headers: { "Content-Type": request.headers.get("Content-Type") ?? "application/json" },
      })));
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const authFailure = requireApiKey(request, env, corsHeaders);
      if (authFailure) return authFailure;

      return withCors(await stub.fetch(new Request("https://agent/status")));
    }

    return new Response("Not Found", { status: 404, headers: corsHeaders });
  },
} satisfies ExportedHandler<Env>;
