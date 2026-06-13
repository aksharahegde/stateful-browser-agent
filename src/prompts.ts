export type Step = {
  action: string;
  observation: string;
  timestamp: number;
};

export type Decision = {
  action: "navigate" | "extract" | "done";
  next_url?: string;
  summary?: string;
};

export function buildSystemPrompt(): string {
  return `You are a browser automation agent. Your job is to help users achieve goals by navigating web pages and extracting information.

You will receive:
- A goal to accomplish
- A list of steps you have already taken
- The latest page observation (text content of the current page)

You MUST respond ONLY with valid JSON matching this exact structure:
{
  "action": "navigate" | "extract" | "done",
  "next_url": "<url>",   // required when action is "navigate"
  "summary": "<text>"    // required when action is "done"
}

Rules:
- Use "navigate" when you need to visit a URL to make progress toward the goal
- Use "extract" when the current page has the information needed but you want to note it before continuing
- Use "done" when you have enough information to fully answer the goal; include a complete summary
- If search results or the current page already contain enough information, use "done" immediately
- Prefer article, docs, and help pages over marketing homepages
- If an observation starts with "[Navigation failed]", do not retry the same URL; use "done" with prior observations
- Do not revisit URLs you have already visited
- Do not loop — if you cannot make progress, use "done" with whatever you have found
- Your entire response must be valid JSON with no additional text, markdown, or explanation`;
}

export function buildDecisionPrompt(goal: string, steps: Step[], observation: string): string {
  const stepsList = steps.length === 0
    ? "None yet."
    : steps
        .map((s, i) => `${i + 1}. Action: ${s.action}\n   Observation: ${s.observation.slice(0, 200)}${s.observation.length > 200 ? "..." : ""}`)
        .join("\n");

  const cappedObservation = observation.slice(0, 3000);

  return `Goal: ${goal}

Previous steps:
${stepsList}

Latest page observation:
${cappedObservation}

Return JSON with action, next_url (if navigating), and summary (if done).`;
}
