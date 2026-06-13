# Interactive Browser Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the browser agent from read-only extraction to full page interaction — fill, click, select, hover, and submit — using a tool-call style protocol where the LLM issues one action per turn and receives structured results.

**Architecture:** Replace the `navigate/extract/done` decision model with a 7-tool schema (`navigate`, `fill`, `click`, `select`, `hover`, `submit`, `done`). The browser page stays open for the duration of the task (created once, closed at the end), and the LLM drives the agent through a growing message history of tool call/result pairs. Page snapshots include both interactive element metadata (selectors + labels) and page text.

**Tech Stack:** TypeScript, Cloudflare Workers, `@cloudflare/puppeteer`, Workers AI (Llama 3.3 70B), Agents SDK, Vitest with `@cloudflare/vitest-pool-workers`

---

## File Map

| File | Change | Responsibility |
|------|--------|----------------|
| `src/prompts.ts` | Modify | `ToolCall` type, `HistoryEntry` type, `Message` type, `buildSystemPrompt()`, `buildMessages()`. Remove `Decision`, `buildDecisionPrompt()`. |
| `src/tools.ts` | Modify | `snapshotPage()`, `executeToolCall()`. Remove `navigateAndExtract()`. Keep `truncate()`, `buildSearchUrl()`, `inferStartUrl()`. |
| `src/agent.ts` | Modify | Restructured `agentLoop` (page created once, tool dispatch loop). `decide()` replaces `think()`. |
| `test/prompts.test.ts` | Modify | Update to test new types and `buildMessages()`. Remove `buildDecisionPrompt` tests. |
| `test/tools.test.ts` | Modify | Add tests for `snapshotPage()` and `executeToolCall()`. |

---

## Task 1: Replace types and builders in `src/prompts.ts`

**Files:**
- Modify: `src/prompts.ts`
- Modify: `test/prompts.test.ts`

- [ ] **Step 1: Write failing tests for the new prompt API**

Replace the contents of `test/prompts.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildMessages, type Step, type ToolCall, type HistoryEntry } from "../src/prompts";

describe("buildSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildSystemPrompt().length).toBeGreaterThan(0);
  });

  it("mentions JSON", () => {
    expect(buildSystemPrompt()).toContain("JSON");
  });

  it("describes all 7 tools", () => {
    const prompt = buildSystemPrompt();
    for (const tool of ["navigate", "fill", "click", "select", "hover", "submit", "done"]) {
      expect(prompt).toContain(tool);
    }
  });
});

describe("buildMessages", () => {
  it("returns [system, user] with no history", () => {
    const msgs = buildMessages("my goal", "page snapshot", []);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toContain("my goal");
    expect(msgs[1].content).toContain("page snapshot");
  });

  it("appends assistant+user pairs for each history entry", () => {
    const history: HistoryEntry[] = [
      {
        toolCall: { tool: "fill", args: { target: "#q", label: "Search", value: "test" } },
        result: '{"result":"success"}',
      },
    ];
    const msgs = buildMessages("goal", "obs", history);
    expect(msgs).toHaveLength(4);
    expect(msgs[2].role).toBe("assistant");
    expect(JSON.parse(msgs[2].content).tool).toBe("fill");
    expect(msgs[3].role).toBe("user");
    expect(msgs[3].content).toBe('{"result":"success"}');
  });

  it("preserves history order for multiple entries", () => {
    const history: HistoryEntry[] = [
      { toolCall: { tool: "navigate", args: { url: "https://example.com" } }, result: '{"result":"success"}' },
      { toolCall: { tool: "done", args: { summary: "done" } }, result: '{"result":"success"}' },
    ];
    const msgs = buildMessages("goal", "obs", history);
    expect(msgs).toHaveLength(6);
    expect(JSON.parse(msgs[2].content).tool).toBe("navigate");
    expect(JSON.parse(msgs[4].content).tool).toBe("done");
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd /Users/aksharadt/Documents/personal/projects/stateful-browser-agent
npx vitest run test/prompts.test.ts
```

Expected: failures — `buildMessages`, `HistoryEntry` not exported; `buildSystemPrompt` missing tool names.

- [ ] **Step 3: Replace `src/prompts.ts` with the new implementation**

```typescript
export type Step = {
  action: string;
  observation: string;
  timestamp: number;
  toolResult?: { result: "success" | "error"; message?: string };
};

export type ToolCall =
  | { tool: "navigate"; args: { url: string } }
  | { tool: "fill";     args: { target: string; label?: string; value: string } }
  | { tool: "click";    args: { target: string; label?: string; reobserve?: boolean } }
  | { tool: "select";   args: { target: string; label?: string; value: string } }
  | { tool: "hover";    args: { target: string; label?: string; reobserve?: boolean } }
  | { tool: "submit";   args: { target?: string } }
  | { tool: "done";     args: { summary: string } };

export type HistoryEntry = {
  toolCall: ToolCall;
  result: string;
};

export type Message = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function buildSystemPrompt(): string {
  return `You are a browser automation agent. You navigate web pages, fill forms, click elements, and extract information to help users achieve goals.

Act by calling exactly one tool per response. Respond ONLY with valid JSON matching one of these schemas:

{"tool":"navigate","args":{"url":"<https URL>"}}
{"tool":"fill","args":{"target":"<CSS selector>","label":"<human label>","value":"<text to type>"}}
{"tool":"click","args":{"target":"<CSS selector>","label":"<human label>","reobserve":<true|false>}}
{"tool":"select","args":{"target":"<CSS selector>","label":"<human label>","value":"<option text>"}}
{"tool":"hover","args":{"target":"<CSS selector>","label":"<human label>","reobserve":<true|false>}}
{"tool":"submit","args":{"target":"<CSS selector or omit for first form on page>"}}
{"tool":"done","args":{"summary":"<complete answer or what was accomplished>"}}

Rules:
- Use selectors from the "=== Interactive Elements ===" section of the page snapshot
- Set reobserve:true on click/hover when you expect the page to change (dropdowns, modals, dynamic fields)
- After navigate and submit you automatically receive an updated page snapshot
- If a tool returns an error, try a different selector or approach
- If you cannot make progress after two consecutive errors on the same goal, call done with what you have
- Call done when you have fully answered the goal or completed the requested task
- Your entire response must be valid JSON with no additional text, markdown, or explanation`;
}

export function buildMessages(
  goal: string,
  firstObservation: string,
  history: HistoryEntry[]
): Message[] {
  const messages: Message[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `Goal: ${goal}\n\n${firstObservation}` },
  ];

  for (const { toolCall, result } of history) {
    messages.push({ role: "assistant", content: JSON.stringify(toolCall) });
    messages.push({ role: "user", content: result });
  }

  return messages;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run test/prompts.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/prompts.ts test/prompts.test.ts
git commit -m "feat: replace Decision/buildDecisionPrompt with ToolCall/buildMessages"
```

---

## Task 2: Add `snapshotPage` to `src/tools.ts`

**Files:**
- Modify: `src/tools.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 1: Write failing tests for `snapshotPage`**

Add this block at the end of `test/tools.test.ts`:

```typescript
import { vi } from "vitest";
import { snapshotPage } from "../src/tools";

describe("snapshotPage", () => {
  it("returns a string containing both sections", async () => {
    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([
          { kind: "input", label: "Email", selector: "#email", type: "email", value: "" },
          { kind: "button", label: "Sign In", selector: "button[type=submit]" },
        ])
        .mockResolvedValueOnce("Welcome back. Sign in to your account."),
    };
    const result = await snapshotPage(mockPage as any);
    expect(result).toContain("=== Interactive Elements ===");
    expect(result).toContain('label="Email"');
    expect(result).toContain('selector="#email"');
    expect(result).toContain("=== Page Content ===");
    expect(result).toContain("Welcome back");
  });

  it("truncates page content to 3000 chars", async () => {
    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce("z".repeat(4000)),
    };
    const result = await snapshotPage(mockPage as any);
    expect(result).toContain("z".repeat(3000));
    expect(result).not.toContain("z".repeat(3001));
  });

  it("includes type and value for input elements", async () => {
    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([
          { kind: "input", label: "Password", selector: "#pwd", type: "password", value: "" },
        ])
        .mockResolvedValueOnce(""),
    };
    const result = await snapshotPage(mockPage as any);
    expect(result).toContain("type=password");
  });

  it("includes options for select elements", async () => {
    const mockPage = {
      evaluate: vi.fn()
        .mockResolvedValueOnce([
          { kind: "select", label: "Country", selector: "#country", options: ["US", "UK", "CA"] },
        ])
        .mockResolvedValueOnce(""),
    };
    const result = await snapshotPage(mockPage as any);
    expect(result).toContain('"US"');
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run test/tools.test.ts
```

Expected: failures — `snapshotPage` not exported from `src/tools`.

- [ ] **Step 3: Add `InteractiveElement` type and `snapshotPage` to `src/tools.ts`**

Add after the `truncate` function (keep all existing exports):

```typescript
type InteractiveElement = {
  kind: "input" | "button" | "select" | "a" | "textarea";
  label: string;
  selector: string;
  type?: string;
  value?: string;
  options?: string[];
  href?: string;
};

export async function snapshotPage(
  page: { evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> }
): Promise<string> {
  const elements = await page.evaluate(() => {
    function bestSelector(el: Element): string {
      const inp = el as HTMLInputElement;
      if (inp.id) return "#" + inp.id;
      if (inp.name) return `[name="${inp.name}"]`;
      if (inp.placeholder) return `[placeholder="${inp.placeholder}"]`;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-child(${idx})`;
    }

    function resolveLabel(el: Element): string {
      const inp = el as HTMLInputElement;
      if (inp.id) {
        const lbl = document.querySelector(`label[for="${inp.id}"]`);
        if (lbl) return (lbl as HTMLElement).innerText.trim().slice(0, 50);
      }
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.slice(0, 50);
      if (inp.placeholder) return inp.placeholder.slice(0, 50);
      if ((el as HTMLElement).innerText) return (el as HTMLElement).innerText.trim().slice(0, 50);
      return inp.name || "";
    }

    const results: Array<{
      kind: string; label: string; selector: string;
      type?: string; value?: string; options?: string[]; href?: string;
    }> = [];

    document.querySelectorAll("input:not([type=hidden]), textarea").forEach(el => {
      const inp = el as HTMLInputElement;
      results.push({
        kind: el.tagName === "TEXTAREA" ? "textarea" : "input",
        label: resolveLabel(el),
        selector: bestSelector(el),
        type: inp.type || undefined,
        value: inp.value || undefined,
      });
    });

    document.querySelectorAll("select").forEach(el => {
      const sel = el as HTMLSelectElement;
      results.push({
        kind: "select",
        label: resolveLabel(el),
        selector: bestSelector(el),
        options: Array.from(sel.options).map(o => o.text).slice(0, 10),
      });
    });

    document.querySelectorAll("button, input[type=submit], input[type=button]").forEach(el => {
      results.push({ kind: "button", label: resolveLabel(el), selector: bestSelector(el) });
    });

    Array.from(document.querySelectorAll("a[href]")).slice(0, 10).forEach(el => {
      results.push({
        kind: "a",
        label: resolveLabel(el),
        selector: bestSelector(el),
        href: (el as HTMLAnchorElement).href,
      });
    });

    return results;
  }) as InteractiveElement[];

  const lines = elements.map(el => {
    let line = `[${el.kind}]   label="${el.label}"   selector="${el.selector}"`;
    if (el.type) line += `   type=${el.type}`;
    if (el.value !== undefined) line += `   value="${el.value}"`;
    if (el.options) line += `   options=${JSON.stringify(el.options)}`;
    if (el.href) line += `   href="${el.href}"`;
    return line;
  }).join("\n");

  const raw = await page.evaluate("document.body.innerText") as string;
  const pageText = truncate(raw.trim().replace(/\n{3,}/g, "\n\n"), 3000);

  return `=== Interactive Elements ===\n${lines}\n\n=== Page Content ===\n${pageText}`;
}
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
npx vitest run test/tools.test.ts
```

Expected: all tests pass (including pre-existing `truncate`, `buildSearchUrl`, `inferStartUrl` tests).

- [ ] **Step 5: Commit**

```bash
git add src/tools.ts test/tools.test.ts
git commit -m "feat: add snapshotPage with structured interactive elements"
```

---

## Task 3: Add `executeToolCall` to `src/tools.ts`

**Files:**
- Modify: `src/tools.ts`
- Modify: `test/tools.test.ts`

- [ ] **Step 1: Write failing tests for `executeToolCall`**

Add this block at the end of `test/tools.test.ts`:

```typescript
import { executeToolCall } from "../src/tools";
import type { ToolCall } from "../src/prompts";

describe("executeToolCall", () => {
  function makeMockPage(overrides: Record<string, unknown> = {}) {
    return {
      type: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      select: vi.fn().mockResolvedValue(["option"]),
      hover: vi.fn().mockResolvedValue(undefined),
      $eval: vi.fn().mockResolvedValue(undefined),
      waitForNavigation: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce("page text"),
      ...overrides,
    };
  }

  it("fill: calls page.type with target and value", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "fill", args: { target: "#email", value: "user@example.com" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.type).toHaveBeenCalledWith("#email", "user@example.com", { delay: 50 });
    expect(result.result).toBe("success");
  });

  it("fill: returns error when page.type throws", async () => {
    const page = makeMockPage({ type: vi.fn().mockRejectedValue(new Error("not found")) });
    const tc: ToolCall = { tool: "fill", args: { target: "#missing", value: "x" } };
    const result = await executeToolCall(page as any, tc);
    expect(result.result).toBe("error");
    expect(result.message).toContain("#missing");
  });

  it("click: calls page.click with target", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "click", args: { target: ".btn" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.click).toHaveBeenCalledWith(".btn");
    expect(result.result).toBe("success");
    expect(result.observation).toBeUndefined();
  });

  it("click: includes observation when reobserve=true", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "click", args: { target: ".btn", reobserve: true } };
    const result = await executeToolCall(page as any, tc);
    expect(result.result).toBe("success");
    expect(result.observation).toBeDefined();
    expect(result.observation).toContain("=== Interactive Elements ===");
  });

  it("select: calls page.select with target and value", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "select", args: { target: "#country", value: "United States" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.select).toHaveBeenCalledWith("#country", "United States");
    expect(result.result).toBe("success");
  });

  it("hover: calls page.hover with target", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "hover", args: { target: ".menu" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.hover).toHaveBeenCalledWith(".menu");
    expect(result.result).toBe("success");
  });

  it("submit: calls page.$eval on the target form", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "submit", args: { target: "form#login" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.$eval).toHaveBeenCalledWith("form#login", expect.any(Function));
    expect(result.result).toBe("success");
    expect(result.observation).toContain("=== Interactive Elements ===");
  });

  it("submit: defaults to 'form' selector when target omitted", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "submit", args: {} };
    await executeToolCall(page as any, tc);
    expect(page.$eval).toHaveBeenCalledWith("form", expect.any(Function));
  });

  it("navigate: calls page.goto and returns observation", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "navigate", args: { url: "https://example.com" } };
    const result = await executeToolCall(page as any, tc);
    expect(page.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    expect(result.result).toBe("success");
    expect(result.observation).toContain("=== Interactive Elements ===");
  });

  it("navigate: returns error when goto throws", async () => {
    const page = makeMockPage({ goto: vi.fn().mockRejectedValue(new Error("timeout")) });
    const tc: ToolCall = { tool: "navigate", args: { url: "https://example.com" } };
    const result = await executeToolCall(page as any, tc);
    expect(result.result).toBe("error");
    expect(result.message).toContain("[Navigation failed]");
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run test/tools.test.ts
```

Expected: failures — `executeToolCall` not exported.

- [ ] **Step 3: Add `ToolResult` type and `executeToolCall` to `src/tools.ts`**

Also add the import for `ToolCall` at the top of `src/tools.ts`:

```typescript
import type { ToolCall } from "./prompts";
```

Add after `snapshotPage`:

```typescript
export type ToolResult = {
  result: "success" | "error";
  message?: string;
  observation?: string;
};

type PageLike = {
  type: (selector: string, text: string, opts?: object) => Promise<void>;
  click: (selector: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<string[]>;
  hover: (selector: string) => Promise<void>;
  $eval: (selector: string, fn: (el: Element) => void) => Promise<void>;
  waitForNavigation: (opts?: object) => Promise<unknown>;
  goto: (url: string, opts?: object) => Promise<unknown>;
  evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
};

export async function executeToolCall(page: PageLike, toolCall: ToolCall): Promise<ToolResult> {
  switch (toolCall.tool) {
    case "fill": {
      try {
        await page.type(toolCall.args.target, toolCall.args.value, { delay: 50 });
        return { result: "success" };
      } catch (err) {
        return { result: "error", message: `Element not found: ${toolCall.args.target}` };
      }
    }

    case "click": {
      try {
        await page.click(toolCall.args.target);
        if (toolCall.args.reobserve) {
          const observation = await snapshotPage(page);
          return { result: "success", observation };
        }
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Click failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "select": {
      try {
        await page.select(toolCall.args.target, toolCall.args.value);
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Select failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "hover": {
      try {
        await page.hover(toolCall.args.target);
        if (toolCall.args.reobserve) {
          const observation = await snapshotPage(page);
          return { result: "success", observation };
        }
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Hover failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "submit": {
      try {
        const selector = toolCall.args.target ?? "form";
        await page.$eval(selector, (el) => (el as HTMLFormElement).submit());
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        const observation = await snapshotPage(page);
        return { result: "success", observation };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Submit failed: ${msg}` };
      }
    }

    case "navigate": {
      try {
        await page.goto(toolCall.args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const observation = await snapshotPage(page);
        return { result: "success", observation };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `[Navigation failed] ${toolCall.args.url}: ${msg}` };
      }
    }

    default:
      return { result: "error", message: "Unknown tool" };
  }
}
```

- [ ] **Step 4: Remove `navigateAndExtract` from `src/tools.ts`**

Delete the `navigateAndExtract` function entirely (lines 3–23 in the original). It is no longer imported anywhere — `agent.ts` will be updated in Task 4.

- [ ] **Step 5: Run all tests and confirm they pass**

```bash
npx vitest run
```

Expected: all tests pass. The `agent.ts` import of `navigateAndExtract` will cause a TypeScript error at this point — that is expected and will be resolved in Task 4.

- [ ] **Step 6: Commit**

```bash
git add src/tools.ts test/tools.test.ts
git commit -m "feat: add executeToolCall and snapshotPage; remove navigateAndExtract"
```

---

## Task 4: Restructure `src/agent.ts` — new loop and `decide()`

**Files:**
- Modify: `src/agent.ts`

- [ ] **Step 1: Replace `src/agent.ts` with the restructured implementation**

```typescript
import { Agent } from "agents";
import puppeteer from "@cloudflare/puppeteer";
import { buildSystemPrompt, buildMessages, type Step, type ToolCall, type HistoryEntry, type Message } from "./prompts";
import { snapshotPage, executeToolCall, inferStartUrl } from "./tools";

// Blocks RFC1918, loopback, link-local, and cloud metadata endpoints to prevent SSRF.
// NOTE(production): hostname-regex checks can be bypassed via DNS rebinding or redirect
// chains. In production, resolve the hostname via DoH and validate every returned IP.
function isSafeUrl(raw: string): boolean {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  const host = parsed.hostname.toLowerCase();
  const privatePatterns = [
    /^localhost$/,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,        // link-local / cloud metadata (AWS, GCP, Azure)
    /^::1$/,
    /^::$/,
    /^0:0:0:0:0:0:0:1$/, // expanded loopback
    /^::ffff:/,           // IPv4-mapped IPv6
    /^fc00:/,
    /^fd[0-9a-f]{2}:/i,  // IPv6 ULA (fd00::/8)
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
      const body = await request.json<{ goal?: unknown }>();
      if (typeof body.goal !== "string" || !body.goal.trim()) {
        return new Response("Missing or invalid goal", { status: 400 });
      }
      const goal = body.goal;

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

    this.setState({ goal, steps: [], status: "running" });
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
      let firstObservation = await snapshotPage(page);
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

        const toolResult = await executeToolCall(page, toolCall);

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

    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages,
        response_format: { type: "json_object" },
      });

      const output = result as Ai_Cf_Meta_Llama_3_3_70B_Instruct_Fp8_Fast_Output;
      const text = typeof output === "string" ? output : ("response" in output ? (output.response ?? "") : "");

      try {
        const toolCall = JSON.parse(text) as ToolCall;
        if (validTools.includes(toolCall.tool)) {
          return toolCall;
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
```

- [ ] **Step 2: Run the full test suite**

```bash
npx vitest run
```

Expected: all tests pass. The `index.test.ts` Worker routing tests should still pass because they mock the DO stub and don't exercise `agentLoop` directly.

- [ ] **Step 3: Verify TypeScript compiles without errors**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent.ts
git commit -m "feat: restructure agentLoop with tool-call protocol and persistent page"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| 7 tools with JSON schema | Task 1 (`ToolCall` type + `buildSystemPrompt`) |
| Hybrid element targeting (label + selector) | Task 2 (`snapshotPage`, `bestSelector`, `resolveLabel`) |
| `reobserve` field on click/hover | Task 3 (`executeToolCall`) |
| navigate/submit always re-snapshot | Task 3 (`executeToolCall`) |
| Page open for full task lifetime | Task 4 (`agentLoop`) |
| `decide()` replaces `think()` | Task 4 |
| `AgentState.steps` updated each turn | Task 4 |
| Hard stop: unsafe navigate URL | Task 4 (`isSafeUrl` in loop) |
| Hard stop: two LLM parse failures → done | Task 4 (`decide()` returns done after 2 attempts) |
| MAX_STEPS = 30 | Task 4 |
| `Step.toolResult` field | Task 1 (type) + Task 4 (populated) |

**Type consistency check:**
- `ToolCall`, `HistoryEntry`, `Message` defined in Task 1, imported in Task 3 and Task 4. ✓
- `snapshotPage` defined in Task 2, used in Task 3 (`executeToolCall`) and Task 4 (`agentLoop`). ✓
- `executeToolCall` defined in Task 3, imported in Task 4. ✓
- `formatStepAction` is a module-private function defined and used only in Task 4. ✓
- `PageLike` interface in `tools.ts` matches the subset of puppeteer `Page` methods used. ✓
