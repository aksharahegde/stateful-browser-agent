# Interactive Browser Agent — Design Spec
_Date: 2026-06-13_

## Overview

Extend the stateful browser agent from read-only page extraction to full page interaction: form filling, clicking, selecting dropdowns, hovering, and submitting forms. The LLM drives the agent via a tool-call style protocol — one tool call per turn, with tool results fed back into the message history before the next LLM call.

---

## 1. Action Schema

The LLM responds with a single JSON tool call per turn:

```json
{ "tool": "fill",    "args": { "target": "#email",              "label": "Email",     "value": "user@example.com" } }
{ "tool": "click",   "args": { "target": "button[type=submit]", "label": "Sign In",   "reobserve": true } }
{ "tool": "select",  "args": { "target": "#country",            "label": "Country",   "value": "United States" } }
{ "tool": "hover",   "args": { "target": ".dropdown-trigger",   "label": "Menu",      "reobserve": true } }
{ "tool": "submit",  "args": { "target": "form#login" } }   // omit target to submit the first form on the page
{ "tool": "navigate","args": { "url": "https://example.com" } }
{ "tool": "done",    "args": { "summary": "Logged in successfully." } }
```

Fields:
- `target` — CSS selector for the element (from the snapshot)
- `label` — human-readable name used for logging; does not affect execution
- `value` — text to type (fill) or option to select (select)
- `reobserve` — if `true`, re-snapshot the page after the action (click, hover only)

`navigate` always re-snapshots. `submit` always re-snapshots. `fill` and `select` never re-snapshot unless the LLM explicitly requests it via a subsequent `click`/`hover` with `reobserve: true`.

---

## 2. Page Snapshot Format

Produced by `snapshotPage(page)` and returned to the LLM as the observation after any re-observe event.

```
=== Interactive Elements ===
[input]   label="Email"           selector="#email"             type=email    value=""
[input]   label="Password"        selector="#password"          type=password value=""
[button]  label="Sign In"         selector="button[type=submit]"
[select]  label="Country"         selector="#country"           options=["United States","Canada","UK"]
[a]       label="Forgot password?" selector=".forgot-link"      href="/reset"

=== Page Content ===
<innerText of document.body, truncated to 3000 chars>
```

### Selector priority (`bestSelector`)
1. `#id` if the element has a unique id
2. `[name="x"]` for form elements with a name attribute
3. `[placeholder="x"]` for inputs with a placeholder
4. Short nth-child path as fallback

### Label resolution priority
1. Associated `<label>` element text
2. `aria-label` attribute
3. `placeholder` attribute
4. `innerText` (buttons, links)

---

## 3. Loop Structure & Page Lifecycle

```
open browser
open page  (once per task)
  snapshot page (initial observation)
  loop (max 30 tool calls):
    call LLM with full message history → receive tool call
    emit SSE event: { type: "tool", tool, args }
    dispatch tool:
      navigate → page.goto(url)                  → always re-snapshot
      fill     → page.type(target, value)         → no re-snapshot by default
      click    → page.click(target)               → re-snapshot if reobserve=true
      select   → page.select(target, value)       → no re-snapshot by default
      hover    → page.hover(target)               → re-snapshot if reobserve=true
      submit   → page.$eval(target, f=>f.submit()) → always re-snapshot
      done     → break loop, emit done event
    append tool result to message history
    if re-snapshot: append new observation to message history
    update AgentState.steps
close page
close browser
```

MAX_STEPS increases from 10 to 30 to accommodate multi-action interaction flows.

The message history passed to the LLM alternates:
- `assistant`: `{"tool": "fill", "args": {...}}`
- `user`: `{"result": "success"}` or `{"result": "error", "message": "..."}`  + optional observation

---

## 4. Error Handling

### Hard stops (abort loop, status = "error")
| Condition | Behaviour |
|-----------|-----------|
| `isSafeUrl` blocks a `navigate` URL | Emit error event, set status = error, close page |
| Two consecutive LLM parse failures | Fall back to `done` with last observation |
| Puppeteer non-recoverable error (browser crash) | Caught in `finally`, browser closed |

### Soft failures (returned to LLM as tool result)
| Condition | LLM sees |
|-----------|----------|
| Element not found | `{"result": "error", "message": "Element not found: #email"}` |
| Navigation timeout < 30s | `{"result": "error", "message": "[Navigation failed] https://...: timeout"}` |
| `select` value not in options | `{"result": "error", "message": "Option 'Foo' not found in #country"}` |
| `hover` on non-hoverable element | `{"result": "error", "message": "Hover failed: ..."}` |

The LLM can retry with a different selector, try a text-based fallback, or call `done` with whatever it has gathered.

---

## 5. File Changes

### `src/prompts.ts`
- Replace `Decision` type with `ToolCall` union type (7 variants)
- Add optional `toolResult` field to `Step` for the LLM message history
- Rewrite `buildSystemPrompt()` to describe all 7 tools with JSON schema and usage rules
- Replace `buildDecisionPrompt()` with `buildMessages()` that constructs the full `Message[]` array from tool call/result history

### `src/tools.ts`
- Replace `navigateAndExtract()` with `snapshotPage(page)` → two-part structured string
- Add `executeToolCall(page, toolCall)` → dispatches fill/click/select/hover/submit, returns `{result, observation?}`
- Add `bestSelector(el)` helper
- Add `resolveLabel(el)` helper
- Keep `truncate()`, `buildSearchUrl()`, `inferStartUrl()` unchanged

### `src/agent.ts`
- Restructure `agentLoop`: page created once, loop dispatches via `executeToolCall`
- Rename `think()` → `decide()`, takes full `Message[]` history
- `AgentState.steps` kept for `/status` — each entry adds optional `toolResult` field
- Initial `isSafeUrl` check on `inferStartUrl` result retained

---

## 6. Out of Scope

- File upload (`<input type="file">`)
- Multi-tab coordination
- iframe interaction
- CAPTCHA handling
- Cookie/session persistence across tasks
