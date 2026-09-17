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
import { STAGES } from '../../src/lib/cases/phases';

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

if (failures > 0) {
  console.error(`\n${failures} wizard step(s) would 404.`);
  process.exit(1);
}
console.log('\nEvery wizard step has a page.');
