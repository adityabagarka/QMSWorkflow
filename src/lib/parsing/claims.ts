/**
 * Reading a claims dump, and the insurer's own summary of it.
 *
 * These stay separate on purpose. The dump is claim-level history we compute
 * from; the MIS is the insurer's account of that history. Where the two
 * disagree, ADR 0011 rule 5 makes it a decision for the RM rather than a
 * display detail — and a parser that merged them into one "claims summary"
 * would quietly pick a winner and destroy the very thing worth negotiating on.
 */
import { CLAIM_FIELDS, matchColumns, valueFor, type Mapping } from './columns';
import { normaliseHeader, type Sheet } from './sheet';
import { parseAmount, parseDate, parseRelationship, parseText } from './values';

export type ClaimRow = {
  rowNumber: number;
  claimRef: string | null;
  memberRef: string | null;
  relationship: string | null;
  claimType: string | null;
  status: string | null;
  incurredOn: string | null;
  reportedOn: string | null;
  claimedAmount: number | null;
  paidAmount: number | null;
  diagnosis: string | null;
  sourceRow: Record<string, unknown>;
};

export type ClaimsIssue = { rowNumber: number | null; detail: string };

export type ClaimsResult = {
  mapping: Mapping;
  claims: ClaimRow[];
  issues: ClaimsIssue[];
  computed: ComputedClaims;
};

export type ComputedClaims = {
  claimsReported: number;
  claimsSettled: number;
  claimsOutstanding: number;
  claimsRejected: number;
  amountClaimed: number;
  amountSettled: number;
  amountOutstanding: number;
  /** Null unless a premium is known — this cannot be computed from a dump alone. */
  incurredClaimsRatio: number | null;
};

/** Insurers spell settlement a dozen ways; the shape of the word is what counts. */
function classifyStatus(value: string | null): 'settled' | 'rejected' | 'outstanding' | 'unknown' {
  const text = (value ?? '').toLowerCase();
  if (!text) return 'unknown';
  if (/reject|repudiat|denied|declin/.test(text)) return 'rejected';
  if (/settl|paid|closed|approved/.test(text)) return 'settled';
  if (/outstand|pending|intimat|open|in\s*process|query/.test(text)) return 'outstanding';
  return 'unknown';
}

export function readClaims(sheet: Sheet, overrides?: Mapping): ClaimsResult {
  const mapping = overrides ?? matchColumns(sheet.headers, CLAIM_FIELDS);
  const claims: ClaimRow[] = [];
  const issues: ClaimsIssue[] = [];

  sheet.rows.forEach((row, i) => {
    const rowNumber = sheet.headerRow + 1 + i;

    const claimed = parseAmount(valueFor(row, mapping, 'claimed_amount'));
    const paid = parseAmount(valueFor(row, mapping, 'paid_amount'));
    const status = parseText(valueFor(row, mapping, 'status'));

    // A row with no money and no claim reference is a spacer or a total line,
    // not a claim. Counting one as a claim inflates the claim count, which is
    // half of every ratio downstream.
    const claimRef = parseText(valueFor(row, mapping, 'claim_ref'));
    if (claimed === null && paid === null && !claimRef) return;

    if (claimed === null && paid === null) {
      issues.push({ rowNumber, detail: `Claim ${claimRef} has no amount on it.` });
    }

    if (paid !== null && claimed !== null && paid > claimed) {
      issues.push({
        rowNumber,
        detail: `Paid (${paid}) is more than claimed (${claimed}) — worth checking with the insurer.`,
      });
    }

    const relationship = parseRelationship(valueFor(row, mapping, 'relationship'));

    claims.push({
      rowNumber,
      claimRef,
      memberRef: parseText(valueFor(row, mapping, 'member_ref')),
      relationship,
      claimType: parseText(valueFor(row, mapping, 'claim_type')),
      status,
      incurredOn: parseDate(valueFor(row, mapping, 'incurred_on')).iso,
      reportedOn: parseDate(valueFor(row, mapping, 'reported_on')).iso,
      claimedAmount: claimed,
      paidAmount: paid,
      diagnosis: parseText(valueFor(row, mapping, 'diagnosis')),
      sourceRow: row as Record<string, unknown>,
    });
  });

  return { mapping, claims, issues, computed: computeClaims(claims) };
}

/**
 * What the dump itself says, before anybody's summary of it.
 *
 * An outstanding claim counts its claimed amount, because that is the exposure;
 * a settled one counts what was paid. Adding paid to claimed across a mixed set
 * — which is the common mistake — double-counts every settled claim.
 */
export function computeClaims(claims: ClaimRow[], premium?: number | null): ComputedClaims {
  let settled = 0;
  let rejected = 0;
  let outstanding = 0;
  let amountClaimed = 0;
  let amountSettled = 0;
  let amountOutstanding = 0;

  for (const claim of claims) {
    amountClaimed += claim.claimedAmount ?? claim.paidAmount ?? 0;

    switch (classifyStatus(claim.status)) {
      case 'settled':
        settled += 1;
        amountSettled += claim.paidAmount ?? 0;
        break;
      case 'rejected':
        rejected += 1;
        break;
      case 'outstanding':
        outstanding += 1;
        amountOutstanding += claim.claimedAmount ?? 0;
        break;
      default:
        // Status unreadable: if money moved, treat it as settled for the
        // amount, since a paid figure is evidence of settlement whatever the
        // column says. It is still not counted as a settled CLAIM, so the
        // count and the amount can disagree — which is exactly the kind of
        // thing the reconciliation against the MIS is there to surface.
        if (claim.paidAmount) amountSettled += claim.paidAmount;
    }
  }

  const incurred = amountSettled + amountOutstanding;

  return {
    claimsReported: claims.length,
    claimsSettled: settled,
    claimsRejected: rejected,
    claimsOutstanding: outstanding,
    amountClaimed,
    amountSettled,
    amountOutstanding,
    incurredClaimsRatio:
      premium && premium > 0 ? Math.round((incurred / premium) * 1000) / 10 : null,
  };
}

/** The metrics an MIS states, and what they are called in the wild. */
const MIS_METRICS: { metric: string; patterns: RegExp[] }[] = [
  {
    metric: 'claims_reported',
    patterns: [
      /claims?\s*(reported|intimated|registered)/,
      /^no\.?\s*of\s*claims/,
      /total\s*claims/,
    ],
  },
  { metric: 'claims_settled', patterns: [/claims?\s*(settled|paid)/, /^settled\s*claims/] },
  {
    metric: 'claims_outstanding',
    patterns: [/claims?\s*(outstanding|pending)/, /^outstanding\s*claims/],
  },
  { metric: 'claims_rejected', patterns: [/claims?\s*(rejected|repudiated|denied)/] },
  { metric: 'amount_claimed', patterns: [/amount\s*(claimed|reported)/, /claimed\s*amount/] },
  {
    metric: 'amount_settled',
    patterns: [/amount\s*(settled|paid)/, /settled\s*amount/, /paid\s*amount/],
  },
  { metric: 'amount_outstanding', patterns: [/amount\s*outstanding/, /outstanding\s*amount/] },
  {
    metric: 'premium',
    patterns: [/^(gross|net|total)?\s*premium/, /premium\s*(collected|received)/],
  },
  {
    metric: 'incurred_claims_ratio',
    patterns: [/incurred\s*claims?\s*ratio/, /\bicr\b/, /claims?\s*ratio/, /loss\s*ratio/],
  },
];

export type StatedFigure = { metric: string; value: number; sourceLabel: string };

/**
 * Reads the figures out of an MIS summary.
 *
 * These files are label/value pairs far more often than they are tables — two
 * columns, or a label column with the number a few cells to the right. So this
 * looks for a known label anywhere in the sheet and takes the first number to
 * its right on the same row, rather than assuming a header layout that half
 * of them do not have.
 */
export function readMis(sheet: Sheet): { figures: StatedFigure[]; unreadable: string[] } {
  const figures = new Map<string, StatedFigure>();
  const unreadable: string[] = [];

  const scan = (cells: unknown[], label: unknown) => {
    const key = normaliseHeader(label);
    if (!key) return;

    const spec = MIS_METRICS.find((m) => m.patterns.some((p) => p.test(key)));
    if (!spec || figures.has(spec.metric)) return;

    for (const cell of cells) {
      const amount = parseAmount(cell);
      if (amount !== null) {
        figures.set(spec.metric, {
          metric: spec.metric,
          value: amount,
          sourceLabel: String(label).trim(),
        });
        return;
      }
    }

    unreadable.push(String(label).trim());
  };

  // A header row with the figures beneath it.
  for (const header of sheet.headers) {
    const column = sheet.rows.map((r) => r[header]);
    scan(column, header);
  }

  // Or label-then-value along a row, which is the more common shape.
  for (const row of sheet.rows) {
    const cells = sheet.headers.map((h) => row[h]);
    for (let i = 0; i < cells.length; i += 1) {
      if (parseAmount(cells[i]) !== null) continue;
      scan(cells.slice(i + 1), cells[i]);
    }
  }

  return { figures: [...figures.values()], unreadable };
}

export type Discrepancy = {
  metric: string;
  stated: number;
  computed: number;
  /** Signed, as a percentage of the stated figure. */
  gapPercent: number;
};

/**
 * Where the insurer's account and ours disagree.
 *
 * Returned rather than resolved. The RM chooses, because a gap between what an
 * insurer reports and what their own data shows is a negotiating position, not
 * a data-quality problem — and a default would train people to stop looking at
 * the most useful number on the screen (ADR 0011 rule 5).
 */
export function findDiscrepancies(
  stated: StatedFigure[],
  computed: ComputedClaims,
  tolerancePercent = 1,
): Discrepancy[] {
  const ours: Record<string, number | null> = {
    claims_reported: computed.claimsReported,
    claims_settled: computed.claimsSettled,
    claims_outstanding: computed.claimsOutstanding,
    claims_rejected: computed.claimsRejected,
    amount_claimed: computed.amountClaimed,
    amount_settled: computed.amountSettled,
    amount_outstanding: computed.amountOutstanding,
    incurred_claims_ratio: computed.incurredClaimsRatio,
  };

  const out: Discrepancy[] = [];

  for (const figure of stated) {
    const mine = ours[figure.metric];
    if (mine === null || mine === undefined) continue;

    // Both zero agree; one zero and the other not is a full disagreement, and
    // dividing by the stated figure would be a division by zero.
    if (figure.value === 0 && mine === 0) continue;

    const gap =
      figure.value === 0 ? 100 : Math.round(((mine - figure.value) / figure.value) * 1000) / 10;

    if (Math.abs(gap) >= tolerancePercent) {
      out.push({ metric: figure.metric, stated: figure.value, computed: mine, gapPercent: gap });
    }
  }

  return out;
}
