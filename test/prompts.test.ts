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
