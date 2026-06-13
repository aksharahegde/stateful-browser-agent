import { describe, it, expect } from "vitest";
import { isSafeUrl } from "../src/urlSafety";

describe("isSafeUrl", () => {
  it("allows public HTTPS URLs", () => {
    expect(isSafeUrl("https://example.com/path")).toBe(true);
    expect(isSafeUrl("https://duckduckgo.com/?q=test")).toBe(true);
  });

  it("blocks non-HTTPS schemes", () => {
    expect(isSafeUrl("http://example.com")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
  });

  it("blocks loopback and private IPv4 ranges", () => {
    expect(isSafeUrl("https://127.0.0.1/")).toBe(false);
    expect(isSafeUrl("https://localhost/")).toBe(false);
    expect(isSafeUrl("https://10.0.0.1/")).toBe(false);
    expect(isSafeUrl("https://192.168.1.1/")).toBe(false);
    expect(isSafeUrl("https://172.16.0.1/")).toBe(false);
    expect(isSafeUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("blocks decimal-encoded IPv4 hostnames", () => {
    expect(isSafeUrl("https://2130706433/")).toBe(false);
  });

  it("blocks cloud metadata hostnames", () => {
    expect(isSafeUrl("https://metadata.google.internal/")).toBe(false);
    expect(isSafeUrl("https://metadata.goog/")).toBe(false);
  });

  it("blocks .internal hostnames", () => {
    expect(isSafeUrl("https://foo.bar.internal/")).toBe(false);
  });

  it("blocks invalid URLs", () => {
    expect(isSafeUrl("not-a-url")).toBe(false);
  });
});
