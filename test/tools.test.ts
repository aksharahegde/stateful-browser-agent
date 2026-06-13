import { describe, it, expect } from "vitest";
import { truncate } from "../src/tools";

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
