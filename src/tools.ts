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
  } finally {
    await page.close();
  }
}

export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
