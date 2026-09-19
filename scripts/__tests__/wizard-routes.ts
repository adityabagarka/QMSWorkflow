/**
 * Every wizard step must have a page behind it.
 *
 * The deal wizard offers six steps and links to all of them. Four of those
 * routes did not exist, so clicking "expiring policy" gave a 404 — the
 * navigation and the pages were separately correct and disagreed with each
 * other, which nothing else catches.
 *
 * Run with `npm run test:routes`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { STAGE, STAGES, stageHref, stageLabel } from '../../src/lib/cases/phases';

const root = join(process.cwd(), 'src', 'app', 'deals', '[id]');
let failures = 0;

for (const stage of STAGES) {
  const page = stage.slug ? join(root, stage.slug, 'page.tsx') : join(root, 'page.tsx');
  const where = stage.slug ? `/deals/[id]/${stage.slug}` : '/deals/[id]';

  if (existsSync(page)) {
    console.log(`ok   step ${stage.phase + 1} (${stage.label}) → ${where}`);
  } else {
    failures += 1;
    console.error(
      `FAIL step ${stage.phase + 1} (${stage.label}) links to ${where}, which has no page`,
    );
  }
}

/*
 * And every named step must still be the step it is named after.
 *
 * Navigation used bare numbers, and when the first three screens merged into
 * one, every step shifted down — a redirect that still said 2 kept working and
 * quietly started pointing at Claims. The button said "members" and the app
 * went to claims, with nothing failing. Names fixed that; this keeps them
 * honest.
 */
const NAMED: [keyof typeof STAGE, string][] = [
  ['deal', 'Deal'],
  ['members', 'Members'],
  ['claims', 'Claims'],
  ['terms', 'Terms & options'],
  ['rfq', 'RFQ'],
];

for (const [name, label] of NAMED) {
  const actual = stageLabel(STAGE[name]);
  if (actual === label) {
    console.log(`ok   STAGE.${name} is ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL STAGE.${name} points at "${actual}", not "${label}"`);
  }
}

const deal = stageHref('abc', STAGE.deal);
if (deal === '/deals/abc') {
  console.log('ok   the deal step is the deal page itself');
} else {
  failures += 1;
  console.error(`FAIL the deal step resolves to ${deal}`);
}

if (STAGE.rfq !== STAGES.length - 1) {
  failures += 1;
  console.error('FAIL the RFQ is not the last step');
}

if (failures > 0) {
  console.error(`\n${failures} problem(s) with the wizard.`);
  process.exit(1);
}
console.log('\nEvery wizard step has a page, and every name points at it.');
