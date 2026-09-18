/*
 * Which typeface each thing is set in, asserted rather than eyeballed.
 *
 * The house rule is narrow: the display serif is for headlines and stat
 * figures, and everything else — labels, values, controls, table cells, empty
 * states — is the UI sans. It had drifted, with read-only field values, the
 * file-drop label and empty states all set in serif, which made a step of a
 * form read like an article about the deal rather than a record of it.
 *
 * This runs against the static pages in this folder, which link the real
 * stylesheet. That is a fair proxy for the app because the font tokens name
 * their fallbacks INSIDE var() — Georgia stands in for Newsreader, system-ui
 * for Hanken Grotesk — so a selector resolves to the same FAMILY here as in the
 * app, even though the faces themselves are the fallbacks.
 *
 * That property is itself worth protecting: written the other way, as
 * `var(--font-hanken), system-ui`, an undefined variable is invalid at
 * computed-value time and takes the whole declaration with it rather than
 * falling through — so every page renders in Times. That is what these
 * screenshots did before, which made them misrepresent the app to whoever was
 * reviewing them.
 *
 * Run with `npm run test:fonts`.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

/** [page, selector, expected role] */
const CASES = [
  ['06-deal-built.html', 'body', 'sans'],
  ['06-deal-built.html', 'h2', 'serif'],
  ['06-deal-built.html', '.summary__name', 'serif'],
  ['06-deal-built.html', '.summary__stat .figure', 'serif'],
  ['06-deal-built.html', '.summary__stat .label', 'sans'],
  ['06-deal-built.html', '.summary__what', 'sans'],
  ['06-deal-built.html', '.summary__rows dd', 'sans'],
  ['06-deal-built.html', '.detail-list dt', 'sans'],
  ['06-deal-built.html', '.detail-list dd', 'sans'],
  ['06-deal-built.html', '.drop__big', 'sans'],
  ['06-deal-built.html', '.wiz__t', 'sans'],
  ['06-deal-built.html', '.wiz__n', 'sans'],
  ['06-deal-built.html', '.button', 'sans'],
  ['06-deal-built.html', '.masthead__name', 'sans'],
  ['06-deal-built.html', '.masthead__role', 'sans'],
  ['05-terms-built.html', '.terms__cell', 'sans'],
  ['05-terms-built.html', '.terms__cell--label', 'sans'],
  ['05-terms-built.html', '.terms__section-name', 'sans'],
  ['05-terms-built.html', '.terms__head > div', 'sans'],
  ['05-terms-built.html', '.opt-name', 'sans'],
];

/*
 * This image ships a pinned Chromium; a GitHub runner does not, and there
 * Playwright resolves its own. Naming a path that does not exist is a hard
 * failure, so only pass one when it is actually there.
 */
const PINNED = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = existsSync(PINNED) ? { executablePath: PINNED } : {};

const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();

let failures = 0;
let lastFile = null;

for (const [file, selector, expected] of CASES) {
  if (file !== lastFile) {
    await page.goto(`file://${process.cwd()}/${file}`);
    lastFile = file;
  }

  const family = await page
    .$eval(selector, (el) => getComputedStyle(el).fontFamily)
    .catch(() => null);

  if (family === null) {
    failures += 1;
    console.error(`  FAIL ${file} ${selector} — no such element to check`);
    continue;
  }

  // The last name in the stack is the generic, and it is the role.
  const actual =
    family.trim().endsWith('serif') && !family.trim().endsWith('sans-serif') ? 'serif' : 'sans';

  if (actual === expected) {
    console.log(`  ok   ${selector.padEnd(24)} ${expected}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${selector.padEnd(24)} want ${expected}, got ${actual} (${family})`);
  }
}

await browser.close();

if (failures > 0) {
  console.error(`\n${failures} selector(s) set in the wrong typeface.`);
  process.exit(1);
}
console.log('\nevery selector is in the typeface its role calls for.');
