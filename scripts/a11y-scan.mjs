// Throwaway Stage 11 accessibility check: runs a real axe-core scan
// against the login page (the one fully public page reachable without a
// live Supabase session) using the real production build. axe-core is
// already a transitive dependency (via eslint-plugin-jsx-a11y) -- no new
// install needed.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const targetUrl = process.argv[2] ?? "http://localhost:3100/login";
const axeSource = readFileSync(
  new globalThis.URL("../node_modules/axe-core/axe.min.js", import.meta.url),
  "utf-8",
);

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  // Strip the app's own CSP for this diagnostic run only, so axe-core
  // (injected as an inline script) can execute -- the production CSP
  // itself is exactly what would otherwise block this exact injection,
  // which is a real, separate confirmation that it's working.
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.goto(targetUrl, { waitUntil: "load" });
  await page.addScriptTag({ content: axeSource });
  const results = await page.evaluate(async () => {
    return await globalThis.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
  });

  console.log(`URL: ${targetUrl}`);
  console.log(`Violations: ${results.violations.length}`);
  for (const v of results.violations) {
    console.log(`\n[${v.impact}] ${v.id}: ${v.description}`);
    for (const node of v.nodes) console.log(`  - ${node.target.join(", ")}: ${node.failureSummary}`);
  }
  console.log(`\nPasses: ${results.passes.length} rules passed.`);

  await browser.close();
  process.exit(results.violations.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
