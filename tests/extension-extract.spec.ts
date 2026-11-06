import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const LONG_TEXT = "Backend Engineer needed with TypeScript, REST APIs and PostgreSQL experience in production.";

async function extract(page: Page, html: string, prepare?: () => void) {
  await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  await page.goto("http://extension-test.local/");
  if (prepare) await page.evaluate(prepare);
  await page.addScriptTag({ path: path.join(process.cwd(), "extension", "extract.js") });
  return page.evaluate(() => (window as unknown as { extractJobText: () => string }).extractJobText());
}

test("selected text wins over the rest of the page", async ({ page }) => {
  const text = await extract(page, `<main><p id="jd">${LONG_TEXT}</p><p>Sidebar noise</p></main>`, () => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("jd")!);
    window.getSelection()!.addRange(range);
  });
  expect(text).toBe(LONG_TEXT);
});

test("a schema.org JobPosting is read as plain text", async ({ page }) => {
  const posting = JSON.stringify({ "@graph": [
    { "@type": "WebSite", name: "Jobs" },
    { "@type": "JobPosting", title: "Backend Engineer", description: `<p>${LONG_TEXT}</p><ul><li>Node.js</li><li>SQL</li></ul>` },
  ] });
  const text = await extract(page, `<script type="application/ld+json">${posting}</script><main>Menu and ads</main>`);
  expect(text).toBe(`Backend Engineer\n${LONG_TEXT}\n- Node.js\n- SQL`);
});

test("broken structured data falls back to the main content", async ({ page }) => {
  const text = await extract(page, `<script type="application/ld+json">{oops</script><nav>Menu</nav><main>${LONG_TEXT}</main>`);
  expect(text).toBe(LONG_TEXT);
});
