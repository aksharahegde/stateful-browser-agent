import { describe, it, expect } from "vitest";
import { truncate, buildSearchUrl, inferStartUrl } from "../src/tools";

describe("truncate", () => {
  it("returns the original string when under the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("returns the original string when exactly at the limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends '...' when over the limit", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  it("truncates to exactly maxLen chars before the ellipsis", () => {
    const result = truncate("abcdef", 3);
    expect(result).toBe("abc...");
    expect(result.length).toBe(6);
  });
});

describe("buildSearchUrl", () => {
  it("builds a DuckDuckGo search URL from the query", () => {
    expect(buildSearchUrl("bank reconciliation")).toBe(
      "https://duckduckgo.com/?q=bank%20reconciliation"
    );
  });
});

describe("inferStartUrl", () => {
  it("routes QuickBooks goals to quickbooks.intuit.com", () => {
    expect(inferStartUrl("Open QuickBooks dashboard")).toBe(
      "https://quickbooks.intuit.com/"
    );
  });

  it("uses search for QuickBooks research goals", () => {
    expect(inferStartUrl("Go to the quickbooks and summarize the key AI capabilities on accounting.")).toBe(
      "https://duckduckgo.com/?q=quickbooks%20Go%20to%20the%20quickbooks%20and%20summarize%20the%20key%20AI%20capabilities%20on%20accounting."
    );
  });

  it("uses a search URL for open-ended research goals", () => {
    expect(inferStartUrl("Search for bank reconciliation processes")).toBe(
      "https://duckduckgo.com/?q=Search%20for%20bank%20reconciliation%20processes"
    );
  });

  it("derives a homepage from go-to phrasing", () => {
    expect(inferStartUrl("Visit stripe and summarize payments API")).toBe(
      "https://www.stripe.com/"
    );
  });
});

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

  it("hover: includes observation when reobserve=true", async () => {
    const page = makeMockPage();
    const tc: ToolCall = { tool: "hover", args: { target: ".menu", reobserve: true } };
    const result = await executeToolCall(page as any, tc);
    expect(result.result).toBe("success");
    expect(result.observation).toBeDefined();
    expect(result.observation).toContain("=== Interactive Elements ===");
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
