import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildDecisionPrompt, type Step } from "../src/prompts";

describe("buildSystemPrompt", () => {
  it("returns a non-empty string", () => {
    expect(buildSystemPrompt().length).toBeGreaterThan(0);
  });

  it("mentions JSON in the output", () => {
    expect(buildSystemPrompt()).toContain("JSON");
  });

  it("mentions all three action types", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("navigate");
    expect(prompt).toContain("extract");
    expect(prompt).toContain("done");
  });
});

describe("buildDecisionPrompt", () => {
  it("includes the goal", () => {
    const result = buildDecisionPrompt("my goal", [], "some page content");
    expect(result).toContain("my goal");
  });

  it("shows 'None yet' when steps array is empty", () => {
    const result = buildDecisionPrompt("goal", [], "content");
    expect(result).toContain("None yet");
  });

  it("numbers and includes previous steps", () => {
    const steps: Step[] = [
      { action: "navigate → https://example.com", observation: "page text", timestamp: 1 },
    ];
    const result = buildDecisionPrompt("goal", steps, "content");
    expect(result).toContain("1. Action: navigate → https://example.com");
  });

  it("truncates step observations to 200 chars", () => {
    const longObs = "x".repeat(300);
    const steps: Step[] = [
      { action: "navigate", observation: longObs, timestamp: 1 },
    ];
    const result = buildDecisionPrompt("goal", steps, "content");
    expect(result).toContain("...");
    expect(result).not.toContain("x".repeat(201));
  });

  it("caps the latest observation at 3000 chars", () => {
    const longObs = "y".repeat(4000);
    const result = buildDecisionPrompt("goal", [], longObs);
    expect(result).not.toContain("y".repeat(3001));
    expect(result).toContain("y".repeat(3000));
  });

  it("includes the latest observation in the output", () => {
    const result = buildDecisionPrompt("goal", [], "unique observation text");
    expect(result).toContain("unique observation text");
  });
});
