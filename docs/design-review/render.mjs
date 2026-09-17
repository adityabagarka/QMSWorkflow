import { chromium } from 'playwright';
const files = process.argv.slice(2);
// The image ships a pinned Chromium; use it rather than downloading another.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
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
