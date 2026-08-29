// One-off Stage 11 measurement (DEV-14): actual load/interactive time for
// /login under a 3G-class network profile, using the production build.
// Not part of the app or its build -- a throwaway diagnostic script, kept
// in the repo so the methodology is reproducible.
import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3100/login";

// Chrome DevTools' standard "Slow 3G" profile (the more conservative of
// the two commonly used "3G-class" presets; "Fast 3G" is ~4x faster and
// would understate the risk). Matches what Lighthouse's "slow4G"/"3G"
// throttling historically used before its 2023 profile revision.
const SLOW_3G = {
  offline: false,
  downloadThroughput: (400 * 1000) / 8, // 400 Kbps
  uploadThroughput: (400 * 1000) / 8,
  latency: 400, // ms RTT
};

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  const client = await page.context().newCDPSession(page);

  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", SLOW_3G);
  // CPU throttling: DevTools' mobile-class default is 4x slowdown.
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  const start = Date.now();
  await page.goto(URL, { waitUntil: "load", timeout: 60_000 });
  const loadWallClock = Date.now() - start;

  const timing = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      domContentLoaded: nav.domContentLoadedEventEnd,
      domInteractive: nav.domInteractive,
      loadEvent: nav.loadEventEnd,
      responseEnd: nav.responseEnd,
      transferSize: nav.transferSize,
    };
  });

  // "Interactive" for a page with no client components (login) is
  // effectively domInteractive -- there is no hydration-blocking JS tree
  // to walk, only the framework runtime's own bootstrap.
  console.log(JSON.stringify({ url: URL, wallClockLoadMs: loadWallClock, ...timing }, null, 2));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
