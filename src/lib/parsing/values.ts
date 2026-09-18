/**
 * Turning a spreadsheet cell into the value it meant.
 *
 * Every function here returns null rather than guessing when it cannot tell,
 * because a wrong date of birth on a roster is a member priced into the wrong
 * age band, and a wrong amount is a burn figure nobody can reconcile.
 */

export type Ambiguity = 'day_first_assumed' | null;

/**
 * Excel stores a date as days since 1899-12-30.
 *
 * The epoch looks wrong by two days and is not: Lotus 1-2-3 treated 1900 as a
 * leap year, Excel kept the bug for compatibility, and every spreadsheet since
 * has inherited it.
 */
function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) return null;

  const ms = Math.round(serial * 86_400_000);
  const date = new Date(Date.UTC(1899, 11, 30) + ms);
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10);
}

function isoFrom(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31 February and friends, which otherwise roll silently into March.
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return date.toISOString().slice(0, 10);
}

/**
 * A date of birth, as "YYYY-MM-DD".
 *
 * The hard case is `03/04/1990`. In India that is 3 April; read as American it
 * is 4 March. Both parse, neither errors, and the member lands in a different
 * age band — so **day-first is assumed**, which is the convention here, and the
 * fact that an assumption was made is returned alongside the value.
 *
 * When the first number is above 12 there is no ambiguity and nothing is
 * flagged. When it is 12 or below on a file that never shows a value above 12
 * in that position, the caller can see that the whole column was a guess.
 */
export function parseDate(value: unknown): { iso: string | null; ambiguity: Ambiguity } {
  if (value === null || value === undefined || value === '') return { iso: null, ambiguity: null };

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { iso: null, ambiguity: null }
      : { iso: value.toISOString().slice(0, 10), ambiguity: null };
  }

  if (typeof value === 'number') return { iso: fromExcelSerial(value), ambiguity: null };

  const text = String(value).trim();
  if (!text) return { iso: null, ambiguity: null };

  // Already unambiguous.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (iso) {
    return { iso: isoFrom(Number(iso[1]), Number(iso[2]), Number(iso[3])), ambiguity: null };
  }

  // A bare number that arrived as text is still an Excel serial.
  if (/^\d{5}$/.test(text)) return { iso: fromExcelSerial(Number(text)), ambiguity: null };

  const parts = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(text);
  if (parts) {
    const first = Number(parts[1]);
    const second = Number(parts[2]);
    let year = Number(parts[3]);

    // Two-digit years: a roster is people, so a year that would put somebody in
    // the future is the previous century. 30 is the usual pivot; above it, an
    // implausible newborn; below it, a plausible child.
    if (year < 100) year += year <= 30 ? 2000 : 1900;

    // First number above 12 can only be a day; second above 12 can only be a
    // month in a day-first reading, so it is month-first.
    if (first > 12) return { iso: isoFrom(year, second, first), ambiguity: null };
    if (second > 12) return { iso: isoFrom(year, first, second), ambiguity: null };

    return { iso: isoFrom(year, second, first), ambiguity: 'day_first_assumed' };
  }

  // "14 Mar 1990", "14-March-90"
  const named =
    /^(\d{1,2})[\s\-/]*([A-Za-z]{3,})[\s\-/]*(\d{2}|\d{4})$/.exec(text) ??
    /^([A-Za-z]{3,})[\s\-/]*(\d{1,2})[\s\-/,]*(\d{2}|\d{4})$/.exec(text);

  if (named) {
    const monthFirst = /^[A-Za-z]/.test(text);
    const day = Number(monthFirst ? named[2] : named[1]);
    const monthName = String(monthFirst ? named[1] : named[2])
      .toLowerCase()
      .slice(0, 3);
    let year = Number(named[3]);
    if (year < 100) year += year <= 30 ? 2000 : 1900;

    const months = [
      'jan',
      'feb',
      'mar',
      'apr',
      'may',
      'jun',
      'jul',
      'aug',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const month = months.indexOf(monthName) + 1;
    if (month === 0) return { iso: null, ambiguity: null };

    return { iso: isoFrom(year, month, day), ambiguity: null };
  }

  return { iso: null, ambiguity: null };
}

/**
 * A rupee amount.
 *
 * Handles the lakh grouping ("1,20,000"), a trailing or leading symbol, and
 * accounting parentheses for negatives. Returns null for anything it cannot
 * read as a number rather than coercing to zero — a claim silently worth
 * nothing is worse than a claim that says it could not be read.
 */
export function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);

  /*
   * "Rs. 41,20,000" used to come back as 0.412. The currency pattern matched
   * "rs" but the optional dot backtracked out of the match, leaving a leading
   * "." that then parsed as a decimal point. Stripping the symbol and the
   * abbreviation separately keeps the dot with the word it belongs to.
   */
  text = text
    .replace(/[₹$]/g, '')
    .replace(/\b(?:inr|rs)\b\.?/gi, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();

  if (!/^-?\d*\.?\d+$/.test(text)) return null;

  const n = Number(text);
  if (!Number.isFinite(n)) return null;

  return negative ? -n : n;
}

/** Whole years from `dob` to `on`, the way an insurer counts age. */
export function ageOn(dob: string | null, on: string): number | null {
  if (!dob) return null;

  const birth = new Date(`${dob}T00:00:00Z`);
  const at = new Date(`${on}T00:00:00Z`);
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) return null;

  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && at.getUTCDate() < birth.getUTCDate())) age -= 1;

  return age >= 0 && age < 130 ? age : null;
}

/** The relationship vocabulary this system uses, whatever the file called it. */
export type Relationship = 'self' | 'spouse' | 'child' | 'parent' | 'parent_in_law' | 'sibling';

const RELATIONSHIPS: { match: RegExp; value: Relationship }[] = [
  // In-laws before parents: "father-in-law" contains "father".
  { match: /in[\s-]?law|fil\b|mil\b/i, value: 'parent_in_law' },
  { match: /^(self|employee|emp|member|primary|e)$|staff/i, value: 'self' },
  { match: /spouse|husband|wife|partner|^s$|^sp$/i, value: 'spouse' },
  { match: /son|daughter|child|children|kid|dependent child|^c$|^d$/i, value: 'child' },
  { match: /father|mother|parent|^p$|^f$|^m$/i, value: 'parent' },
  { match: /brother|sister|sibling|^b$/i, value: 'sibling' },
];

export function parseRelationship(value: unknown): Relationship | null {
  const text = String(value ?? '').trim();
  if (!text) return null;

  for (const { match, value: relationship } of RELATIONSHIPS) {
    if (match.test(text)) return relationship;
  }
  return null;
}

export type Gender = 'male' | 'female' | 'other';

export function parseGender(value: unknown): Gender | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!text) return null;
  if (/^m(ale)?$/.test(text)) return 'male';
  if (/^f(emale)?$/.test(text)) return 'female';
  if (/^(o|other|transgender|non[\s-]?binary)$/.test(text)) return 'other';
  return null;
}

/** Trimmed display text, or null. Collapses the whitespace Excel leaves behind. */
export function parseText(value: unknown): string | null {
  const text = String(value ?? '')
    .replace(/[ \s]+/g, ' ')
    .trim();
  return text === '' ? null : text;
}
