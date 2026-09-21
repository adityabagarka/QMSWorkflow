/**
 * Filling the deal from the policy — and what a folded section still submits.
 *
 * Both halves here are regressions from one deal: the legal name was on the
 * screen and the save said it was missing, while the activity said the policy
 * had been read and the incumbent insurer, broker, TPA and premium were empty.
 * Neither fault was in the parser — it read all of them — so neither was caught
 * by `test:policy-facts`.
 *
 * Run with `npm run test:policy-fill`.
 */
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Section } from '../../src/components/form-section';
import {
  firstWriteError,
  planPolicyFill,
  type Held,
  type ReadValue,
} from '../../src/app/deals/[id]/policy-fill-plan';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${(err as Error).message}`);
  }
}

const EMPTY: Held = {
  legal_name: null,
  gstin: null,
  location: null,
  insurer_name: null,
  broker_name: null,
  tpa_name: null,
  expiring_premium: null,
  policy_expiry_date: null,
};

const read = (value: string, page = 1): ReadValue => ({ value, page });

console.log('\na folded section still submits');

check('inputs inside a folded section stay in the form', () => {
  // `new FormData(form)` reads the DOM. A section that unmounted its children
  // when folded took the legal name out of the DOM with it, so a save made
  // with the company folded submitted no legal name at all — rejected as
  // missing, with the value plainly on the screen.
  const markup = renderToStaticMarkup(
    React.createElement(Section, {
      title: 'Company',
      defaultOpen: false,
      children: React.createElement('input', {
        name: 'legal_name',
        defaultValue: 'Acme Widgets',
      }),
    }),
  );

  assert.match(markup, /name="legal_name"/, 'the input is still rendered');
  assert.match(markup, /hidden/, 'and hidden rather than removed');
});

check('an open section is not hidden', () => {
  const markup = renderToStaticMarkup(
    React.createElement(Section, {
      title: 'Deal',
      defaultOpen: true,
      children: React.createElement('input', { name: 'expiring_premium' }),
    }),
  );

  assert.match(markup, /name="expiring_premium"/);
  assert.doesNotMatch(markup, /formsec__body" hidden/);
});

console.log('\nwhat the fill decides to write');

check('the city is filled from the policy like any other fact', () => {
  const plan = planPolicyFill({ location: read('Pune, Maharashtra', 3) }, EMPTY);

  assert.equal(plan.customerPatch.location, 'Pune, Maharashtra');
  assert.equal(plan.filled, 1);
  assert.deepEqual(plan.readings, [
    {
      field: 'location',
      read_value: 'Pune, Maharashtra',
      read_page: 3,
      saved_value: 'Pune, Maharashtra',
    },
  ]);
});

check('a city already on the customer is not overwritten', () => {
  const plan = planPolicyFill(
    { location: read('Pune, Maharashtra') },
    { ...EMPTY, location: 'Bengaluru, Karnataka' },
  );

  assert.deepEqual(plan.customerPatch, {}, 'what somebody entered stands');
  assert.equal(
    plan.readings[0]?.saved_value,
    'Bengaluru, Karnataka',
    'and the reading records both',
  );
  assert.equal(plan.readings[0]?.read_value, 'Pune, Maharashtra');
});

check('the incumbent programme goes to the policy, not the customer', () => {
  const plan = planPolicyFill(
    {
      insurerName: read('ICICI Lombard'),
      brokerName: read('Marsh India'),
      tpaName: read('Medi Assist'),
      premium: read('4500000'),
      policyEnd: read('2027-03-31'),
      policyholderName: read('Synthetic Softworks Private Limited'),
    },
    EMPTY,
  );

  assert.deepEqual(plan.policyPatch, {
    insurer_name: 'ICICI Lombard',
    broker_name: 'Marsh India',
    tpa_name: 'Medi Assist',
    expiring_premium: '4500000',
  });
  assert.equal(plan.expiry, '2027-03-31');
  assert.deepEqual(plan.customerPatch, { legal_name: 'Synthetic Softworks Private Limited' });
  assert.equal(plan.filled, 6);
});

check('a premium of zero already held still counts as held', () => {
  const plan = planPolicyFill({ premium: read('4500000') }, { ...EMPTY, expiring_premium: 0 });
  assert.deepEqual(plan.policyPatch, {});
});

check('a GSTIN is never taken as the legal name', () => {
  const plan = planPolicyFill({ policyholderName: read('29AAACI7904G1ZJ') }, EMPTY);
  assert.deepEqual(plan.customerPatch, {});
  assert.equal(plan.readings.length, 0, 'and it is not recorded as a name that was read');
});

check('facts with nowhere to go are neither written nor recorded', () => {
  const plan = planPolicyFill({ policyNumber: read('GHI-2026-0001'), lives: read('412') }, EMPTY);
  assert.deepEqual(plan.customerPatch, {});
  assert.deepEqual(plan.policyPatch, {});
  assert.equal(plan.readings.length, 0);
});

console.log('\na write that did not happen');

check('a failed write is reported rather than swallowed', () => {
  // This is the whole fault: the customers patch landed, the policies patch
  // failed on a column staging had not been migrated to, and the fill still
  // recorded the read — which is what stops it ever running again.
  const failure = firstWriteError([
    ['customers', { error: null }],
    ['policies', { error: { message: 'column policies.tpa_name does not exist' } }],
    ['cases', { error: null }],
  ]);

  assert.equal(failure?.table, 'policies');
  assert.match(failure!.message, /tpa_name/);
});

check('all writes landing reports nothing', () => {
  assert.equal(firstWriteError([['customers', { error: null }]]), null);
  assert.equal(firstWriteError([]), null);
});

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nall policy fill assertions passed.');
