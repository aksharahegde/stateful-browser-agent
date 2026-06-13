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
