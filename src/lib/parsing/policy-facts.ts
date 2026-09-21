import { parseAmount, parseDate } from '@/lib/parsing/values';
import { CITIES, cityLabel } from '@/lib/cases/cities';
import { bespokePages, type PdfPage, type PdfText } from '@/lib/parsing/pdf-text';

/**
 * The facts on a policy schedule that need no model to read.
 *
 * Every one of these is a labelled value on the first page or two: the insurer,
 * the TPA, the broker, the period, the sum insured, the premium, the GSTIN.
 * They are patterned enough for rules, and rules are free, instant and — unlike
 * a model — incapable of inventing a plausible answer.
 *
 * The benefit table is deliberately NOT here. Measured across fifteen real
 * policies, no benefit could be found by label in every one of them: every
 * insurer writes "Day Care" where the catalogue says "Daycare Treatments", and
 * Bajaj states room rent in a prose paragraph beneath the table. That is the
 * work the model does (ADR 0012); this is the work it should never have to.
 */

export type Fact<T> = {
  value: T;
  /** The line it was read from, for the same reason terms carry their clause. */
  evidence: string;
  page: number;
};

export type PolicyFacts = {
  insurerName: Fact<string> | null;
  tpaName: Fact<string> | null;
  brokerName: Fact<string> | null;
  policyNumber: Fact<string> | null;
  policyStart: Fact<string> | null;
  policyEnd: Fact<string> | null;
  sumInsured: Fact<number> | null;
  premium: Fact<number> | null;
  gstin: Fact<string> | null;
  policyholderName: Fact<string> | null;
  /** The customer's city, as `"Pune, Maharashtra"` — the Location vocabulary. */
  location: Fact<string> | null;
  lives: Fact<number> | null;
};

export type FactsOutcome =
  | { ok: true; facts: PolicyFacts; pagesRead: number; pagesSkipped: number }
  | { ok: false; reason: 'unreadable'; message: string };

/** How an insurer names itself on its own schedule. */
const INSURER_MARKERS: [RegExp, string][] = [
  [/tata\s*aig/i, 'Tata AIG'],
  [/icici\s*lombard/i, 'ICICI Lombard'],
  [/bajaj\s*(allianz|general)/i, 'Bajaj'],
  [/hdfc\s*ergo/i, 'HDFC ERGO'],
  [/care\s+health/i, 'Care Health'],
  [/niva\s*bupa/i, 'Niva Bupa'],
  [/star\s+health/i, 'Star Health'],
  [/new\s+india\s+assurance/i, 'New India Assurance'],
  [/oriental\s+insurance/i, 'Oriental Insurance'],
  [/united\s+india/i, 'United India'],
  [/national\s+insurance/i, 'National Insurance'],
  [/aditya\s*birla/i, 'Aditya Birla Health'],
  [/manipal\s*cigna/i, 'ManipalCigna'],
  [/go\s*digit/i, 'Go Digit'],
  [/iffco\s*tokio/i, 'IFFCO Tokio'],
  [/sbi\s+general/i, 'SBI General'],
  [/reliance\s+general|indusind\s+general/i, 'IndusInd General'],
  [/universal\s+sompo/i, 'Universal Sompo'],
  [/cholamandalam|chola\s*ms/i, 'Chola MS'],
  [/royal\s+sundaram/i, 'Royal Sundaram'],
  [/future\s+generali|generali\s+central/i, 'Generali Central'],
  [/liberty\s+general/i, 'Liberty'],
  [/zuno|edelweiss\s+general/i, 'Zuno'],
];

/**
 * Labels as the three insurers actually write them.
 *
 * Several labels per field, because none of them agree: TATA AIG says "Claims
 * Administrator" where ICICI says "Third Party Administrator", and the broker
 * is the "Intermediary Name" on one and the "Broker" on another.
 */
const LABELS: Record<string, RegExp[]> = {
  tpaName: [
    /claims?\s+administrator/i,
    /third\s+party\s+administrator/i,
    /\btpa\s+name\b/i,
    /^\s*tpa\b/i,
  ],
  brokerName: [/intermediary\s+name/i, /^\s*broker\b/i, /broker\s+name/i, /agent\s*\/\s*broker/i],
  policyNumber: [/policy\s*(no|number)\b/i, /policy\s*num[-\s]*ber/i],
  policyholderName: [
    /policy\s*holder'?s?\s+name/i,
    /insured\s+name/i,
    /name\s+of\s+(the\s+)?insured/i,
    /proposer\s+name/i,
  ],
  gstin: [/\bgstin\b/i, /\bgst\s*(no|number|in)\b/i],
  sumInsured: [/sum\s+insured/i, /total\s+sum\s+insured/i],
  premium: [/net\s+premium/i, /total\s+premium/i, /gross\s+premium/i, /premium\s+amount/i],
  lives: [/total\s+no\.?\s+of\s+insured\s+person/i, /total\s+lives/i, /number\s+of\s+lives/i],
};

/**
 * Where the customer's own address is announced.
 *
 * Deliberately not a bare `/address/`: every schedule carries the insurer's
 * registered office, the TPA's service address and a grievance address, and any
 * of those would put the wrong city on the company. The label has to say whose
 * address it is, or sit inside the policyholder block.
 */
const ADDRESS_LABELS: RegExp[] = [
  /policy\s*holder'?s?\s+address/i,
  /insured'?s?\s+address/i,
  /address\s+of\s+(the\s+)?(insured|policy\s*holder|proposer)/i,
  /(communication|mailing|correspondence)\s+address/i,
  /client\s+address/i,
];

/** An Indian PIN code — what makes a block of text an address rather than prose. */
const PIN = /\b[1-9]\d{5}\b/;

/**
 * The city list, longest name first.
 *
 * Longest first so "Navi Mumbai" is not read as "Mumbai" and "New Delhi" not as
 * "Delhi" — both pairs are in the list, and both resolve to different rows.
 */
const CITY_PATTERNS: { label: string; pattern: RegExp }[] = [...CITIES]
  .sort((a, b) => b.city.length - a.city.length)
  .map((entry) => ({
    label: cityLabel(entry),
    pattern: new RegExp(
      `(^|[^A-Za-z])${entry.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`,
      'i',
    ),
  }));

const GSTIN = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]{3}\b/;

/**
 * A GSTIN on a schedule belongs to the insurer unless something says otherwise.
 *
 * ICICI Lombard prints theirs and not the customer's: the only GSTIN in a
 * 52-page Poshmark policy is "GSTIN Reg. No : 29AAACI7904G1ZJ", which is ICICI
 * Lombard's own. Taken as the customer's it puts an insurer's tax number on a
 * company — and `customers.gstin` is unique, so the next ICICI deal would
 * collide with the first and fail for reasons nobody could read.
 *
 * TATA AIG prints the customer's, in the policyholder block, with none of these
 * markers beside it. So the markers decide, and a GSTIN that cannot be
 * attributed is left out: no GSTIN is a blank somebody fills in, and the wrong
 * one is a wrong company.
 */
const INSURER_GSTIN_MARKERS =
  /\b(reg\.?\s*no|registration|registered\s+office|corporate\s+office|cin|irda|gic\b|insurance\s+compan)/i;

/**
 * A date as Indian policies write one. All four forms are in the sample:
 * 08/04/2026 (TATA AIG), 16-APR-26 (Bajaj), 1 Nov 2026, and Mar 28, 2026
 * (ICICI Lombard, month first with a comma).
 */
const DATE =
  /\b(\d{1,2}[/-][A-Za-z]{3}[/-]\d{2,4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/;

/**
 * Everything that could be the value for a label on this line, in order of
 * likelihood.
 *
 * Not one candidate: a schedule is a table flattened into lines, and the value
 * sits in the next column, or two columns over, or on the line below. The first
 * version took only the text immediately after the label and stopped, which
 * lost the premium on every TATA AIG policy — where the label row reads "Net
 * Premium (₹) | Add: Applicable Taxes (₹) | Total Gross Premium (₹)" and the
 * figures are on the line beneath — and the sum insured on every ICICI one,
 * where the value is simply in the next column.
 */
function candidatesAfter(lines: string[], index: number, label: RegExp): string[] {
  const line = lines[index] ?? '';
  const match = label.exec(line);
  if (!match) return [];

  const out: string[] = [];

  // The separator between a label and its value is punctuation, and ICICI
  // Lombard puts it on a line of its own: label, then ":", then the value.
  const clean = (segment: string) => segment.replace(/^[\s:\t.\-–—]+/, '').trim();

  const rest = line.slice(match.index + match[0].length);
  for (const segment of rest.split('\t')) {
    const trimmed = clean(segment);
    if (trimmed.length > 0) out.push(trimmed);
  }

  for (let i = index + 1; i < Math.min(index + 3, lines.length); i += 1) {
    for (const segment of (lines[i] ?? '').split('\t')) {
      const trimmed = clean(segment);
      if (trimmed.length > 0) out.push(trimmed);
    }
  }

  return out;
}

function scan<T>(
  pages: PdfPage[],
  labels: RegExp[],
  extract: (raw: string, line: string) => T | null,
): Fact<T> | null {
  for (const { page, lines } of pages) {
    for (let i = 0; i < lines.length; i += 1) {
      for (const label of labels) {
        for (const raw of candidatesAfter(lines, i, label)) {
          const value = extract(raw, lines[i] ?? '');
          if (value !== null && value !== undefined) {
            return { value, evidence: (lines[i] ?? '').replace(/\t/g, ' ').trim(), page };
          }
        }
      }
    }
  }
  return null;
}

const asText = (raw: string): string | null => {
  const cleaned = raw.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length >= 2 && cleaned.length <= 120 ? cleaned : null;
};

const asAmount = (raw: string): number | null => {
  const value = parseAmount(raw);
  // Policy figures are lakhs and crores; anything tiny is a row number or a
  // clause reference that happened to sit beside the label.
  return value !== null && value >= 1000 ? value : null;
};

const asDate = (raw: string): string | null => {
  const match = DATE.exec(raw);
  if (!match) return null;
  const parsed = parseDate(match[1]);
  return parsed?.iso ?? null;
};

/**
 * Reads what the schedule states plainly.
 *
 * Only the bespoke pages are scanned. The filed wording repeats every one of
 * these labels in its definitions — "Sum Insured means the amount stated in the
 * Schedule" — and reading those would replace a real figure with a sentence.
 */
export function readPolicyFacts(text: PdfText): FactsOutcome {
  if (!text.usable) {
    return {
      ok: false,
      reason: 'unreadable',
      message:
        'That PDF has no readable text layer — it decodes to symbols rather than words. Enter the details by hand, or upload a copy saved from the insurer portal rather than a printed and rescanned one.',
    };
  }

  /*
   * Every bespoke page, not the first few. ICICI Lombard opens with a
   * Customer Information Sheet and a coverage summary, and the actual schedule
   * — period, lives, sum insured, premium — is on page seven or later. A
   * six-page window read the cover sheet and stopped.
   *
   * Safe to widen because the filed wording has already been trimmed off: it is
   * the wording that repeats these labels in its definitions, and first match
   * wins, so an earlier page is still preferred.
   */
  const pages = bespokePages(text);
  const head = pages;

  // The insurer names itself in its own letterhead and footer rather than
  // against a label, so it is matched on the text instead of scanned for.
  let insurerName: Fact<string> | null = null;
  outer: for (const { page, lines } of head) {
    for (const line of lines) {
      for (const [pattern, name] of INSURER_MARKERS) {
        if (pattern.test(line)) {
          insurerName = { value: name, evidence: line.replace(/\t/g, ' ').trim(), page };
          break outer;
        }
      }
    }
  }

  const dates = scanPeriod(head);

  /*
   * A GSTIN is a checksummed 15-character pattern that occurs nowhere else, so
   * where no label carries one it is still safe to take from the text. Several
   * schedules print it in a footer block with no label at all.
   */
  let gstin: Fact<string> | null = null;
  outerGstin: for (const { page, lines } of head) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] ?? '').replace(/\t/g, ' ');
      const found = GSTIN.exec(line.toUpperCase());
      if (!found) continue;

      // The insurer names itself around its own number, on the same line or
      // the one after — "IL GIC GSTIN Address", "Registered office", the CIN.
      const context = [lines[i - 1] ?? '', line, lines[i + 1] ?? ''].join(' ');
      if (INSURER_GSTIN_MARKERS.test(context)) continue;
      if (insurerName && new RegExp(insurerName.value.split(' ')[0]!, 'i').test(context)) continue;

      gstin = { value: found[0], evidence: line.trim(), page };
      break outerGstin;
    }
  }

  return {
    ok: true,
    pagesRead: pages.length,
    pagesSkipped: text.pages.length - pages.length,
    facts: {
      insurerName,
      tpaName: scan(head, LABELS.tpaName!, asText),
      brokerName: scan(head, LABELS.brokerName!, asText),
      /*
       * A policy number is an identifier: mostly digits, long, and not a
       * sentence. Without that it read "a. Policy schedule" off ICICI
       * Lombard's Customer Information Sheet, whose second column says which
       * clause to look at rather than what the value is.
       */
      policyNumber: scan(head, LABELS.policyNumber!, (raw) => {
        const candidate = raw.trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9/\-]{7,}$/.test(candidate)) return null;
        if (!/\d{4}/.test(candidate)) return null;
        return candidate;
      }),
      policyholderName: scan(head, LABELS.policyholderName!, asText),
      location: scanLocation(head, insurerName),
      gstin,
      sumInsured: scan(head, LABELS.sumInsured!, asAmount),
      premium: scan(head, LABELS.premium!, asAmount),
      lives: scan(head, LABELS.lives!, (raw) => {
        const n = parseAmount(raw);
        return n !== null && n >= 1 && n <= 1000000 ? Math.round(n) : null;
      }),
      policyStart: dates.start,
      policyEnd: dates.end,
    },
  };
}

/**
 * The customer's city, read off the address on the schedule.
 *
 * Industry, website and LinkedIn are not on a policy and never will be; the
 * address is, on every schedule that names a policyholder at all. Taking the
 * city from it saves the one company fact the document actually carries.
 *
 * Two guards, because a schedule is full of addresses that are not the
 * customer's. The window is refused if the insurer names itself in it or if it
 * reads as a registered office, a CIN or an IRDAI line; and the block has to
 * look like an address — a PIN code, or the city's own state beside it — before
 * a city name in it counts. A wrong city is worse than no city: it is a fact
 * about the company that nobody typed and everybody trusts.
 *
 * The value returned is a `CITIES` label ("Pune, Maharashtra"), so what the
 * parser writes and what the Location typeahead offers are the same vocabulary.
 */
function scanLocation(pages: PdfPage[], insurerName: Fact<string> | null): Fact<string> | null {
  const insurerWord = insurerName ? new RegExp(insurerName.value.split(' ')[0]!, 'i') : null;

  const read = (labels: RegExp[], span: number): Fact<string> | null => {
    for (const { page, lines } of pages) {
      for (let i = 0; i < lines.length; i += 1) {
        const line = (lines[i] ?? '').replace(/\t/g, ' ');
        if (!labels.some((label) => label.test(line))) continue;

        const window = lines
          .slice(i, i + span)
          .join(' ')
          .replace(/\t/g, ' ');

        if (INSURER_GSTIN_MARKERS.test(window)) continue;
        if (insurerWord && insurerWord.test(window)) continue;

        for (const { label, pattern } of CITY_PATTERNS) {
          if (!pattern.test(window)) continue;
          const state = label.slice(label.indexOf(', ') + 2);
          if (!PIN.test(window) && !new RegExp(state, 'i').test(window)) continue;
          return { value: label, evidence: window.replace(/\s+/g, ' ').trim().slice(0, 200), page };
        }
      }
    }
    return null;
  };

  /*
   * A labelled address first. Where there is none — TATA AIG prints the
   * policyholder's address under their name with no label of its own — the
   * block beneath the policyholder name is read instead, which is why that
   * fallback has the tighter window.
   */
  return read(ADDRESS_LABELS, 6) ?? read(LABELS.policyholderName!, 5);
}

/**
 * The cover period.
 *
 * Kept apart from the labelled scan because it is written as a pair — "From
 * 08/04/2026 To 07/04/2027", or as "Risk Inception Date" and "Risk Expiry
 * Date" rows — and reading either date alone gives a period nobody can check.
 */
function scanPeriod(pages: PdfPage[]): {
  start: Fact<string> | null;
  end: Fact<string> | null;
} {
  for (const { page, lines } of pages) {
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] ?? '').replace(/\t/g, ' ');
      if (!/policy\s+period|period\s+of\s+insurance|risk\s+incep/i.test(line)) continue;

      /*
       * The pair can sit either side of the label. TATA AIG prints "From
       * 08/04/2026" above the words "Policy Period" and "To 07/04/2027" below
       * them, so a window that only looks forward finds one date and reports a
       * period nobody can check.
       */
      const window = [lines[i - 1] ?? '', line, lines[i + 1] ?? '', lines[i + 2] ?? '']
        .join(' ')
        .replace(/\t/g, ' ');
      const found = [...window.matchAll(new RegExp(DATE, 'g'))]
        .map((m) => parseDate(m[1])?.iso)
        .filter((d): d is string => Boolean(d));

      if (found.length >= 2) {
        const [start, end] = [...found].sort();
        return {
          start: { value: start!, evidence: line.trim(), page },
          end: { value: end!, evidence: line.trim(), page },
        };
      }
    }
  }
  return { start: null, end: null };
}
