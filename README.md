# Stateful Browser Agent

A stateful Cloudflare Worker that uses [Workers AI](https://developers.cloudflare.com/workers-ai/) (Llama 3.3 70B) and [Browser Rendering](https://developers.cloudflare.com/browser-rendering/) (Puppeteer) to accomplish natural-language goals through real page interaction. Session state is persisted in a [Durable Object](https://developers.cloudflare.com/durable-objects/) via the [Agents SDK](https://developers.cloudflare.com/agents/).

## Features

- Natural-language goals via the built-in web UI or `POST /run`
- Tool-call loop: `navigate`, `fill`, `click`, `select`, `hover`, `submit`, `done`
- Structured page snapshots with interactive element selectors for the LLM
- Server-Sent Events (SSE) streaming of step-by-step progress
- Persistent agent state via the `AgentSession` Durable Object (`GET /status`)
- SSRF protections on navigation (`isSafeUrl` in `src/agent.ts`)

## Architecture

```mermaid
flowchart LR
  Client["Browser / API client"] -->|POST /run| Worker["Cloudflare Worker"]
  Client -->|GET /| Worker
  Worker -->|RPC| AgentDO["AgentSession DO"]
  AgentDO -->|launch| Browser["Browser Rendering"]
  AgentDO -->|run| AI["Workers AI"]
  Browser -->|snapshot + actions| AgentDO
  AI -->|tool call JSON| AgentDO
  AgentDO -->|SSE events| Client
```

The Worker routes HTTP requests to a single `AgentSession` Durable Object stub. The agent loop opens one browser page per task, snapshots the DOM, asks the LLM for one tool call per turn, executes it, and feeds results back into message history until the LLM calls `done` or the step limit is reached.

## Prerequisites

- Node.js and npm
- A Cloudflare account with **Browser Rendering** and **Workers AI** enabled
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) authenticated via `wrangler login`

Both the `browser` and `ai` bindings in `wrangler.jsonc` use `"remote": true`, so local development calls Cloudflare's remote Browser Rendering and Workers AI services. No `.dev.vars` secrets are required — the LLM runs through the `AI` binding, not external API keys.

## Quick start

```bash
npm install
npm run dev      # wrangler dev — open the printed URL, use the UI at /
npm test         # vitest
npm run deploy   # wrangler deploy
npm run types    # wrangler types
```

After `npm run dev`, open `http://localhost:8787/` (Wrangler's default port), enter a goal, and click **Run**.

### API example

```bash
curl -N -X POST http://localhost:8787/run \
  -H "Content-Type: application/json" \
  -d '{"goal":"Summarize Cloudflare Browser Rendering docs"}'
```

The response is a stream of SSE `data:` lines. Use `-N` with curl to disable buffering.

## API reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Demo UI (inline HTML) |
| `POST` | `/run` | Start the agent. Body: `{ "goal": string }`. Returns `text/event-stream`. |
| `GET` | `/status` | Current Durable Object state (JSON). |
| `OPTIONS` | `/*` | CORS preflight (204). |

### `POST /run` request

```json
{ "goal": "Go to example.com and describe the homepage" }
```

Returns `400` if `goal` is missing or not a non-empty string.

### `GET /status` response

```json
{
  "goal": "…",
  "steps": [
    {
      "action": "fill \"user@example.com\" → #email",
      "observation": "…",
      "timestamp": 1718280000000,
      "toolResult": { "result": "success" }
    }
  ],
  "status": "idle | running | done | error",
  "finalSummary": "…"
}
```

### SSE event types

Each event is a JSON object on a `data:` line:

| `type` | Payload | Description |
|--------|---------|-------------|
| `start` | `{ goal }` | Agent run started |
| `plan` | `{ url }` | Inferred start URL from the goal |
| `launching` | — | Browser session starting |
| `observe` | `{ length }` | Initial page snapshot captured |
| `tool` | `{ tool, args }` | LLM chose a tool call |
| `step_result` | `{ result, message? }` | Tool execution result (`success` or `error`) |
| `done` | `{ summary }` | Task finished |
| `error` | `{ message }` | Hard stop (unsafe URL, blocked navigation, etc.) |

**Demo session note:** The Worker currently routes all requests to a fixed Durable Object name (`demo-session`). For production, derive the session ID from an authenticated principal (see TODO in `src/index.ts`).

## Tool protocol

The LLM responds with exactly one JSON tool call per turn. Selectors must come from the `=== Interactive Elements ===` section of the page snapshot.

| Tool | Purpose | Re-snapshot after action |
|------|---------|--------------------------|
| `navigate` | Go to an HTTPS URL | Always |
| `fill` | Type into an input | No (unless followed by click/hover with `reobserve`) |
| `click` | Click an element | If `reobserve: true` |
| `select` | Choose a dropdown option | No |
| `hover` | Hover over an element | If `reobserve: true` |
| `submit` | Submit a form | Always |
| `done` | Finish with a summary | Ends the loop |

Example tool calls:

```json
{ "tool": "navigate", "args": { "url": "https://example.com" } }
{ "tool": "fill",    "args": { "target": "#email", "label": "Email", "value": "user@example.com" } }
{ "tool": "click",   "args": { "target": "button[type=submit]", "label": "Sign In", "reobserve": true } }
{ "tool": "select",  "args": { "target": "#country", "label": "Country", "value": "United States" } }
{ "tool": "hover",   "args": { "target": ".dropdown-trigger", "label": "Menu", "reobserve": true } }
{ "tool": "submit",  "args": { "target": "form#login" } }
{ "tool": "done",    "args": { "summary": "Logged in successfully." } }
```

Rules:

- One tool call per LLM turn; results are appended to message history before the next call.
- Maximum **30** steps per run.
- Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with JSON response format.
- Soft failures (element not found, timeout) are returned to the LLM as tool results so it can retry; hard failures (blocked URL) abort the run.

For snapshot format, selector priority, and error-handling tables, see the [design spec](docs/superpowers/specs/2026-06-13-interactive-browser-agent-design.md).

## Project structure

```
src/
  index.ts    Worker routing, CORS, demo UI
  agent.ts    AgentSession Durable Object and agent loop
  tools.ts    Page snapshots, tool execution, URL inference
  prompts.ts  System prompt and message history builders
test/         Vitest unit tests (prompts, tools, routing)
docs/superpowers/
  specs/      Design specifications
  plans/      Implementation plans
wrangler.jsonc  Worker, Browser, AI, and Durable Object bindings
```

## Limitations and production notes

**Out of scope** (see design spec):

- File upload (`<input type="file">`)
- Multi-tab coordination
- iframe interaction
- CAPTCHA handling
- Cookie/session persistence across tasks

**Security:**

- Navigation is restricted to HTTPS URLs that pass `isSafeUrl` (blocks localhost, private IP ranges, link-local, and cloud metadata hosts).
- Hostname-regex checks can be bypassed via DNS rebinding or redirect chains; production deployments should resolve hostnames via DoH and validate every returned IP.
- Post-navigation redirect checks are applied in `executeToolCall` for the `navigate` tool.

**Operational:**

- Session IDs should be tied to authenticated users, not a shared demo name.
- The demo UI is inline HTML in `src/index.ts`, served at `/`.

## Related docs

- [Interactive Browser Agent — Design Spec](docs/superpowers/specs/2026-06-13-interactive-browser-agent-design.md)
- [Interactive Browser Agent — Implementation Plan](docs/superpowers/plans/2026-06-13-interactive-browser-agent.md)
- [Cloudflare Browser Rendering](https://developers.cloudflare.com/browser-rendering/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
