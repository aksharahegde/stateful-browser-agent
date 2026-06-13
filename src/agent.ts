import { Agent } from "agents";
import puppeteer from "@cloudflare/puppeteer";
import { buildSystemPrompt, buildDecisionPrompt, type Step, type Decision } from "./prompts";
import { navigateAndExtract } from "./tools";

// Blocks RFC1918, loopback, link-local, and cloud metadata endpoints to prevent SSRF.
function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,   // link-local / cloud metadata (AWS, GCP, Azure)
    /^::1$/,
    /^fc00:/,
    /^fd/,
  ];
  return !privatePatterns.some((re) => re.test(host));
}

type AgentState = {
  goal: string;
  steps: Step[];
  status: "idle" | "running" | "done" | "error";
  finalSummary?: string;
};

export class AgentSession extends Agent<Env, AgentState> {
  initialState: AgentState = {
    goal: "",
    steps: [],
    status: "idle",
  };

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json(this.state);
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const { goal } = await request.json<{ goal: string }>();

      const { readable, writable } = new TransformStream<string, string>();
      const writer = writable.getWriter();
      const encoded = readable.pipeThrough(new TextEncoderStream());

      this.ctx.waitUntil(
        this.agentLoop(goal, writer)
          .catch(async (err) => {
            await writer.write(`data: ${JSON.stringify({ type: "error", message: String(err) })}\n\n`);
            this.setState({ ...this.state, status: "error" });
          })
          .finally(() => writer.close())
      );

      return new Response(encoded, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    return new Response("Not Found", { status: 404 });
  }

  private async agentLoop(goal: string, writer: WritableStreamDefaultWriter<string>): Promise<void> {
    const MAX_STEPS = 10;

    this.setState({ goal, steps: [], status: "running" });

    const emit = async (event: Record<string, unknown>) => {
      await writer.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await emit({ type: "start", goal });

    const browser = await puppeteer.launch(this.env.BROWSER);
    try {
      let currentUrl = "https://developers.cloudflare.com/browser-rendering/";
      let observation = "";
      const steps: Step[] = [];

      for (let i = 0; i < MAX_STEPS; i++) {
        await emit({ type: "step", step: i + 1, action: "navigate", url: currentUrl });

        observation = await navigateAndExtract(browser, currentUrl);

        await emit({ type: "observe", url: currentUrl, length: observation.length });

        const decision = await this.think(goal, steps, observation);

        const step: Step = {
          action: `${decision.action}${decision.next_url ? ` → ${decision.next_url}` : ""}`,
          observation,
          timestamp: Date.now(),
        };
        steps.push(step);
        this.setState({ ...this.state, steps });

        await emit({ type: "think", action: decision.action, next_url: decision.next_url });

        if (decision.action === "done") {
          this.setState({ ...this.state, status: "done", finalSummary: decision.summary });
          await emit({ type: "done", summary: decision.summary });
          return;
        }

        if (decision.next_url) {
          if (!isSafeUrl(decision.next_url)) {
            await emit({ type: "error", message: `Blocked unsafe URL: ${decision.next_url}` });
            this.setState({ ...this.state, status: "error" });
            return;
          }
          currentUrl = decision.next_url;
        }
      }

      this.setState({ ...this.state, status: "done" });
      await emit({ type: "done", summary: "Max steps reached. " + (steps[steps.length - 1]?.observation.slice(0, 500) ?? "") });

    } finally {
      await browser.close();
    }
  }

  private async think(goal: string, steps: Step[], observation: string): Promise<Decision> {
    const messages = [
      { role: "system" as const, content: buildSystemPrompt() },
      { role: "user" as const, content: buildDecisionPrompt(goal, steps, observation) },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages,
        response_format: { type: "json_object" },
      });

      const output = result as Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Output;
      const text = typeof output === "string" ? output : ("response" in output ? (output.response ?? "") : "");

      try {
        const decision = JSON.parse(text) as Decision;
        if (decision.action === "navigate" || decision.action === "extract" || decision.action === "done") {
          return decision;
        }
      } catch {
        // retry
      }
    }

    return { action: "done", summary: observation.slice(0, 500) };
  }
}
