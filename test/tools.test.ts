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
