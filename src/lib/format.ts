/**
 * Presentation helpers, in one place so the standing rules hold everywhere.
 *
 * Three of them are house rules rather than formatting preferences:
 *
 *   - The date a deal turns on is when the NEW cover starts. Screens lead with
 *     it and count down to it; the expiring policy's dates are supporting
 *     detail.
 *   - Every premium in this system excludes GST. That is a standing rule, not a
 *     caption: it is said where somebody TYPES a figure, and once on the quote
 *     comparison. It is not repeated wherever a figure is displayed, which is
 *     noise that trains people to stop reading it.
 *   - Every date and time is India time. See TIME_ZONE below.
 */

/**
 * The business runs in India, so every date and time a person reads is IST,
 * and "today" means today in India.
 *
 * This is not cosmetic. The runtime clock is UTC — Vercel's functions, the
 * Postgres server and this container all are — and IST is UTC+5:30. Between
 * 18:30 and midnight India time, UTC has not yet rolled over, so anything
 * formatted or counted in the server's own zone is a day behind: an audit entry
 * written at 11pm would be filed under yesterday, and a countdown to inception
 * would read one day longer than it is. Both are wrong in ways nobody would
 * notice until a renewal date is missed.
 *
 * Instants are still STORED in UTC (every column is `timestamptz`, which is an
 * absolute moment, not a wall clock). This constant is about reading them back.
 */
export const TIME_ZONE = 'Asia/Kolkata';

/**
 * One locale for every date, time and figure. en-IN gives the 12-hour clock
 * people here read and the lakh/crore digit grouping `formatRupees` relies on;
 * using it for dates too means a screen never mixes two conventions.
 */
const LOCALE = 'en-IN';

/** For a field where a premium is entered. Not for displaying one. */
export const GST_INPUT_HINT = 'Exclusive of GST';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: TIME_ZONE,
  });
}

/** A moment, not a day: for audit entries and anything else with a clock time. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(LOCALE, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}

/**
 * The calendar day `instant` falls on in India, as "YYYY-MM-DD".
 *
 * `toLocaleDateString` with `en-CA` is the shortest way to get ISO ordering out
 * of Intl; the point is that the zone conversion happens inside Intl rather
 * than by adding 5.5 hours by hand, which would be wrong the moment India ever
 * changed its offset.
 */
function istDay(instant: Date): string {
  return instant.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

/**
 * Whole days from today until `value`; negative once it has passed.
 *
 * Both sides are reduced to a calendar day in India first, then differenced as
 * plain dates — so the answer never depends on the time of day, on the server's
 * zone, or on whether the value carries a clock time at all.
 */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;

  // A bare "YYYY-MM-DD" is already a calendar day and means that day in India;
  // converting it through a zone would shift it. Anything else is an instant.
  const then = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : istDay(new Date(value));
  const today = istDay(new Date());

  const ms = Date.parse(`${then}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/** Whole years between `value` and today, in India. */
export function yearsSince(value: string | null | undefined): number | null {
  const days = daysUntil(value);
  return days === null ? null : Math.floor(-days / 365.25);
}

/**
 * The countdown to inception, on the design system's four-step severity scale.
 * Urgency rises as the date approaches because the reminder cascade (§11) and
 * the room to negotiate both shrink with it.
 */
export function coverStartChip(coverStart: string | null | undefined): {
  className: string;
  label: string;
} {
  const days = daysUntil(coverStart);

  if (days === null) return { className: 'chip chip--settled', label: 'date not set' };
  if (days < 0) return { className: 'chip chip--critical', label: `${Math.abs(days)}d overdue` };
  if (days === 0) return { className: 'chip chip--critical', label: 'starts today' };
  if (days <= 15) return { className: 'chip chip--critical', label: `${days} days` };
  if (days <= 30) return { className: 'chip chip--urgent', label: `${days} days` };
  if (days <= 60) return { className: 'chip chip--waiting', label: `${days} days` };
  return { className: 'chip', label: `${days} days` };
}

/** Indian digit grouping: ₹41,20,000 rather than ₹4,120,000. */
export function formatRupees(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-IN');
}

/** "Pvt Ltd · Transport & Logistics · Pune", skipping whatever is not known. */
export function describeCompany(parts: (string | null | undefined)[]): string {
  const known = parts.filter((p): p is string => Boolean(p && p.trim()));
  return known.length > 0 ? known.join(' · ') : 'Details not captured yet';
}
