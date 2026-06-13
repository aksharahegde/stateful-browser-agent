import { Agent } from "agents";
import puppeteer from "@cloudflare/puppeteer";
import { buildMessages, type Step, type ToolCall, type HistoryEntry } from "./prompts";
import { snapshotPage, executeToolCall, inferStartUrl } from "./tools";
import { isSafeUrl, unsafeUrlMessage } from "./urlSafety";

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
      if (this.state.status === "running") {
        return new Response("Agent is already running", { status: 409 });
      }

      const body = await request.json<{ goal?: unknown }>();
      if (typeof body.goal !== "string" || !body.goal.trim()) {
        return new Response("Missing or invalid goal", { status: 400 });
      }
      const goal = body.goal.trim();
      if (goal.length > 4096) {
        return new Response("Goal exceeds maximum length of 4096 characters", { status: 400 });
      }

      this.setState({ goal, steps: [], status: "running" });

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
    const MAX_STEPS = 30;

    const emit = async (event: Record<string, unknown>) => {
      await writer.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await emit({ type: "start", goal });

    const startUrl = inferStartUrl(goal);
    if (!isSafeUrl(startUrl)) {
      await emit({ type: "error", message: `Blocked unsafe start URL: ${startUrl}` });
      this.setState({ ...this.state, status: "error" });
      return;
    }
    await emit({ type: "plan", url: startUrl });
    await emit({ type: "launching" });

    const browser = await puppeteer.launch(this.env.BROWSER);
    const page = await browser.newPage();

    try {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      const initialUrl = page.url();
      if (!isSafeUrl(initialUrl)) {
        await emit({ type: "error", message: unsafeUrlMessage(initialUrl, "Blocked URL after redirect") });
        this.setState({ ...this.state, status: "error" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let firstObservation = await snapshotPage(page as any);
      await emit({ type: "observe", length: firstObservation.length });

      const history: HistoryEntry[] = [];
      const steps: Step[] = [];

      for (let i = 0; i < MAX_STEPS; i++) {
        const toolCall = await this.decide(goal, firstObservation, history);
        await emit({ type: "tool", tool: toolCall.tool, args: "args" in toolCall ? toolCall.args : {} });

        if (toolCall.tool === "done") {
          this.setState({ ...this.state, status: "done", finalSummary: toolCall.args.summary });
          await emit({ type: "done", summary: toolCall.args.summary });
          return;
        }

        if (toolCall.tool === "navigate" && !isSafeUrl(toolCall.args.url)) {
          await emit({ type: "error", message: `Blocked unsafe URL: ${toolCall.args.url}` });
          this.setState({ ...this.state, status: "error" });
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResult = await executeToolCall(page as any, toolCall, isSafeUrl);

        const resultPayload = JSON.stringify({
          result: toolResult.result,
          ...(toolResult.message ? { message: toolResult.message } : {}),
        });
        const historyResult = toolResult.observation
          ? `${resultPayload}\n\n${toolResult.observation}`
          : resultPayload;

        history.push({ toolCall, result: historyResult });

        if (toolResult.observation) {
          firstObservation = toolResult.observation;
        }

        const step: Step = {
          action: formatStepAction(toolCall),
          observation: toolResult.observation?.slice(0, 200) ?? firstObservation.slice(0, 200),
          timestamp: Date.now(),
          toolResult: { result: toolResult.result, message: toolResult.message },
        };
        steps.push(step);
        this.setState({ ...this.state, steps });

        await emit({ type: "step_result", result: toolResult.result, message: toolResult.message });
      }

      this.setState({ ...this.state, status: "done" });
      await emit({
        type: "done",
        summary: "Max steps reached. " + (steps[steps.length - 1]?.observation.slice(0, 500) ?? ""),
      });

    } finally {
      try { await page.close(); } catch {}
      try { await browser.close(); } catch {}
    }
  }

  private async decide(
    goal: string,
    firstObservation: string,
    history: HistoryEntry[]
  ): Promise<ToolCall> {
    const messages = buildMessages(goal, firstObservation, history);
    const validTools = ["navigate", "fill", "click", "select", "hover", "submit", "done"];

    function hasRequiredArgs(tc: unknown): tc is ToolCall {
      if (typeof tc !== "object" || tc === null) return false;
      const c = tc as Record<string, unknown>;
      if (typeof c.tool !== "string" || !validTools.includes(c.tool)) return false;
      const args = c.args as Record<string, unknown> | undefined;
      if (typeof args !== "object" || args === null) return false;
      switch (c.tool) {
        case "navigate": return typeof args.url === "string";
        case "fill":     return typeof args.target === "string" && typeof args.value === "string";
        case "click":    return typeof args.target === "string";
        case "select":   return typeof args.target === "string" && typeof args.value === "string";
        case "hover":    return typeof args.target === "string";
        case "submit":   return true; // target is optional
        case "done":     return typeof args.summary === "string";
        default:         return false;
      }
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages,
        response_format: { type: "json_object" },
      });

      const output = result as Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Output;
      const text = typeof output === "string" ? output : ("response" in output ? (output.response ?? "") : "");

      try {
        const parsed: unknown = JSON.parse(text);
        if (hasRequiredArgs(parsed)) {
          return parsed;
        }
      } catch {
        // retry
      }
    }

    return { tool: "done", args: { summary: "Could not parse LLM response. " + firstObservation.slice(0, 500) } };
  }
}

function formatStepAction(toolCall: ToolCall): string {
  switch (toolCall.tool) {
    case "navigate": return `navigate → ${toolCall.args.url}`;
    case "fill":     return `fill "${toolCall.args.value}" → ${toolCall.args.target}`;
    case "click":    return `click ${toolCall.args.label ?? toolCall.args.target}`;
    case "select":   return `select "${toolCall.args.value}" in ${toolCall.args.target}`;
    case "hover":    return `hover ${toolCall.args.label ?? toolCall.args.target}`;
    case "submit":   return `submit ${toolCall.args.target ?? "form"}`;
    case "done":     return "done";
  }
}
