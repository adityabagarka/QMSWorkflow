/**
 * Presentation helpers, in one place so the standing rules hold everywhere.
 *
 * Two of them are house rules rather than formatting preferences:
 *
 *   - The date a deal turns on is when the NEW cover starts. Screens lead with
 *     it and count down to it; the expiring policy's dates are supporting
 *     detail.
 *   - Premiums exclude GST. That is stated once, against the figure, by the
 *     component showing it — never repeated as helper text elsewhere.
 */

export const GST_NOTE = 'Excluding GST';

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Whole days from today until `value`; negative once it has passed. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const then = new Date(value);
  then.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((then.getTime() - now.getTime()) / 86_400_000);
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
