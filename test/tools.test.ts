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
