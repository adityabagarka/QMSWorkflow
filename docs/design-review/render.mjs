import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
const files = process.argv.slice(2);
/*
 * This image ships a pinned Chromium; a GitHub runner does not, and there
 * Playwright resolves its own. Naming a path that does not exist is a hard
 * failure, so only pass one when it is actually there.
 */
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(PINNED) ? { executablePath: PINNED } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
for (const f of files) {
  await page.goto(`file://${process.cwd()}/${f}`);
  await page.waitForTimeout(250);
  const out = f.replace('.html', '.png');
  await page.screenshot({ path: out, fullPage: true });
  console.log('rendered', out);
}
await browser.close();
