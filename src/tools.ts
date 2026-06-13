import puppeteer from "@cloudflare/puppeteer";

export async function navigateAndExtract(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
  url: string
): Promise<string> {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const raw = await page.evaluate("document.body.innerText") as string;
    const cleaned = raw.trim().replace(/\n{3,}/g, "\n\n");
    return truncate(cleaned, 8000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `[Navigation failed] ${url}: ${message}`;
  } finally {
    try {
      await page.close();
    } catch {
      // Page may already be closed after a navigation error.
    }
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function buildSearchUrl(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

const SITE_URLS: Record<string, string> = {
  quickbooks: "https://quickbooks.intuit.com/",
  intuit: "https://www.intuit.com/",
};

export function inferStartUrl(goal: string): string {
  const lower = goal.toLowerCase();
  const wantsResearch = /\b(?:summarize|summary|search|find|explain|capabilities|features|process|how|what)\b/.test(lower);

  for (const [name, url] of Object.entries(SITE_URLS)) {
    if (lower.includes(name)) {
      return wantsResearch ? buildSearchUrl(`${name} ${goal}`) : url;
    }
  }

  const goToMatch = goal.match(/\b(?:go to|visit|open)\s+(?:the\s+)?([a-z0-9][\w-]*)/i);
  if (goToMatch) {
    const name = goToMatch[1].toLowerCase();
    if (SITE_URLS[name]) {
      return wantsResearch ? buildSearchUrl(`${name} ${goal}`) : SITE_URLS[name];
    }
    // Explicit "visit/go to X" always navigates directly for unknown sites.
    return `https://www.${name}.com/`;
  }

  return buildSearchUrl(goal);
}
