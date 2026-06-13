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

type InteractiveElement = {
  kind: "input" | "button" | "select" | "a" | "textarea";
  label: string;
  selector: string;
  type?: string;
  value?: string;
  options?: string[];
  href?: string;
};

export async function snapshotPage(
  page: { evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown> }
): Promise<string> {
  const elements = await page.evaluate(() => {
    function bestSelector(el: Element): string {
      const inp = el as HTMLInputElement;
      if (inp.id) return "#" + CSS.escape(inp.id);
      if (inp.name) return `[name="${CSS.escape(inp.name)}"]`;
      if (inp.placeholder) return `[placeholder="${CSS.escape(inp.placeholder)}"]`;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      const idx = siblings.indexOf(el) + 1;
      return `${tag}:nth-of-type(${idx})`;
    }

    function resolveLabel(el: Element): string {
      const inp = el as HTMLInputElement;
      if (inp.id) {
        const lbl = document.querySelector(`label[for="${inp.id}"]`);
        if (lbl) return (lbl as HTMLElement).innerText.trim().slice(0, 50);
      }
      const aria = el.getAttribute("aria-label");
      if (aria) return aria.slice(0, 50);
      if (inp.placeholder) return inp.placeholder.slice(0, 50);
      if ((el as HTMLElement).innerText) return (el as HTMLElement).innerText.trim().slice(0, 50);
      return inp.name || "";
    }

    const results: Array<{
      kind: string; label: string; selector: string;
      type?: string; value?: string; options?: string[]; href?: string;
    }> = [];

    document.querySelectorAll("input:not([type=hidden]), textarea").forEach(el => {
      const inp = el as HTMLInputElement;
      results.push({
        kind: el.tagName === "TEXTAREA" ? "textarea" : "input",
        label: resolveLabel(el),
        selector: bestSelector(el),
        type: inp.type || undefined,
        value: inp.value || undefined,
      });
    });

    document.querySelectorAll("select").forEach(el => {
      const sel = el as HTMLSelectElement;
      results.push({
        kind: "select",
        label: resolveLabel(el),
        selector: bestSelector(el),
        options: Array.from(sel.options).map(o => o.text).slice(0, 10),
      });
    });

    document.querySelectorAll("button, input[type=submit], input[type=button]").forEach(el => {
      results.push({ kind: "button", label: resolveLabel(el), selector: bestSelector(el) });
    });

    Array.from(document.querySelectorAll("a[href]")).slice(0, 10).forEach(el => {
      results.push({
        kind: "a",
        label: resolveLabel(el),
        selector: bestSelector(el),
        href: (el as HTMLAnchorElement).href,
      });
    });

    return results;
  }) as InteractiveElement[];

  const lines = elements.map(el => {
    let line = `[${el.kind}]   label="${el.label}"   selector="${el.selector}"`;
    if (el.type) line += `   type=${el.type}`;
    if (el.value !== undefined) line += `   value="${el.value}"`;
    if (el.options) line += `   options=${JSON.stringify(el.options)}`;
    if (el.href) line += `   href="${el.href}"`;
    return line;
  }).join("\n");

  const raw = await page.evaluate("document.body.innerText") as string;
  const pageText = truncate(raw.trim().replace(/\n{3,}/g, "\n\n"), 3000);

  return `=== Interactive Elements ===\n${lines}\n\n=== Page Content ===\n${pageText}`;
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
