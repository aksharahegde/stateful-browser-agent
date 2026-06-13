import type { ToolCall } from "./prompts";

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

export type ToolResult = {
  result: "success" | "error";
  message?: string;
  observation?: string;
};

type PageLike = {
  type: (selector: string, text: string, opts?: object) => Promise<void>;
  click: (selector: string) => Promise<void>;
  select: (selector: string, value: string) => Promise<string[]>;
  hover: (selector: string) => Promise<void>;
  $eval: (selector: string, fn: (el: Element) => void) => Promise<void>;
  waitForNavigation: (opts?: object) => Promise<unknown>;
  goto: (url: string, opts?: object) => Promise<unknown>;
  evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
  url: () => string;
};

type UrlValidator = (url: string) => boolean | Promise<boolean>;

async function blockedNavigation(
  page: PageLike,
  isUrlSafe?: UrlValidator
): Promise<ToolResult | null> {
  if (!isUrlSafe) return null;
  const currentUrl = page.url();
  const allowed = await isUrlSafe(currentUrl);
  if (!allowed) {
    return { result: "error", message: `Navigation blocked: unsafe URL ${currentUrl}` };
  }
  return null;
}

export async function executeToolCall(
  page: PageLike,
  toolCall: ToolCall,
  isUrlSafe?: UrlValidator
): Promise<ToolResult> {
  switch (toolCall.tool) {
    case "fill": {
      try {
        // Clear existing value before typing to avoid appending to existing content.
        await page.evaluate(
          (sel) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (el) el.value = "";
          },
          toolCall.args.target
        );
        await page.type(toolCall.args.target, toolCall.args.value, { delay: 50 });
        return { result: "success" };
      } catch {
        return { result: "error", message: `Element not found: ${toolCall.args.target}` };
      }
    }

    case "click": {
      try {
        await page.click(toolCall.args.target);
        const blocked = await blockedNavigation(page, isUrlSafe);
        if (blocked) return blocked;
        if (toolCall.args.reobserve) {
          const observation = await snapshotPage(page);
          return { result: "success", observation };
        }
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Click failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "select": {
      try {
        // page.select() needs the HTML value attribute, not display text.
        // Look up the matching option by text or value, fall back to raw input.
        const optionValue = await page.evaluate(
          (sel, text) => {
            const el = document.querySelector(sel) as HTMLSelectElement | null;
            if (!el) return null;
            const opt = Array.from(el.options).find(
              (o) => o.text.trim() === text || o.value === text
            );
            return opt ? opt.value : null;
          },
          toolCall.args.target,
          toolCall.args.value
        ) as string | null;

        if (optionValue === null) {
          return { result: "error", message: `Option '${toolCall.args.value}' not found in ${toolCall.args.target}` };
        }
        await page.select(toolCall.args.target, optionValue);
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Select failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "hover": {
      try {
        await page.hover(toolCall.args.target);
        const blocked = await blockedNavigation(page, isUrlSafe);
        if (blocked) return blocked;
        if (toolCall.args.reobserve) {
          const observation = await snapshotPage(page);
          return { result: "success", observation };
        }
        return { result: "success" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Hover failed on ${toolCall.args.target}: ${msg}` };
      }
    }

    case "submit": {
      try {
        const selector = toolCall.args.target ?? "form";
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
          page.$eval(selector, (el) => (el as HTMLFormElement).submit()),
        ]);
        const blocked = await blockedNavigation(page, isUrlSafe);
        if (blocked) return blocked;
        const observation = await snapshotPage(page);
        return { result: "success", observation };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `Submit failed: ${msg}` };
      }
    }

    case "navigate": {
      try {
        await page.goto(toolCall.args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        const blocked = await blockedNavigation(page, isUrlSafe);
        if (blocked) return blocked;
        const observation = await snapshotPage(page);
        return { result: "success", observation };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { result: "error", message: `[Navigation failed] ${toolCall.args.url}: ${msg}` };
      }
    }

    default:
      return { result: "error", message: "Unknown tool" };
  }
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
