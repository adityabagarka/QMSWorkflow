/**
 * Which deals the list is showing, as a question the URL can hold.
 *
 * The filters live in the query string rather than in component state, for
 * three reasons that each came up on the deal list before this existed: a
 * filtered list can be sent to somebody, the browser's back button returns to
 * what you were looking at instead of the whole list, and the filtering happens
 * in the database — a page that filters in JavaScript has to fetch every deal
 * to show four.
 *
 * Everything here is pure, so `npm run test:deal-filters` can state what each
 * filter means without a database.
 */

export type DealFilters = {
  /** `cases.current_phase` — the step the deal is sitting on. */
  stage: number | null;
  /** `YYYY-MM` of the cover start, or `'none'` for deals with no date yet. */
  month: string | null;
  /** The incumbent insurer's name as `policies.insurer_name` holds it. */
  insurer: string | null;
  /** `cases.customer_id` — the company, not the deal. */
  customer: string | null;
  /** `cases.deal_type`. */
  dealType: string | null;
  /** Whose deals: `'mine'`, or every deal the viewer is allowed to see. */
  owner: 'mine' | null;
};

export const NO_FILTERS: DealFilters = {
  stage: null,
  month: null,
  insurer: null,
  customer: null,
  dealType: null,
  owner: null,
};

/** The query-string name of each filter, which is also the form field name. */
export const FILTER_PARAMS = {
  stage: 'stage',
  month: 'month',
  insurer: 'insurer',
  customer: 'customer',
  dealType: 'type',
  owner: 'owner',
} as const;

/** Deals whose cover start is not set yet — a real answer, not a missing one. */
export const NO_MONTH = 'none';

type ParamBag = Record<string, string | string[] | undefined>;

function one(params: ParamBag, key: string): string | null {
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The filters a request is asking for.
 *
 * Anything unrecognised is dropped rather than passed to the database: these
 * values reach a query, and a hand-typed `?stage=banana` should show the whole
 * list rather than an error page.
 */
export function readDealFilters(params: ParamBag): DealFilters {
  const stageRaw = one(params, FILTER_PARAMS.stage);
  const stage = stageRaw !== null && /^[0-9]+$/.test(stageRaw) ? Number(stageRaw) : null;

  const monthRaw = one(params, FILTER_PARAMS.month);
  const month =
    monthRaw === NO_MONTH || (monthRaw !== null && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthRaw))
      ? monthRaw
      : null;

  const ownerRaw = one(params, FILTER_PARAMS.owner);

  return {
    stage: stage !== null && stage >= 0 && stage <= 6 ? stage : null,
    month,
    insurer: one(params, FILTER_PARAMS.insurer),
    customer: one(params, FILTER_PARAMS.customer),
    dealType: one(params, FILTER_PARAMS.dealType),
    owner: ownerRaw === 'mine' ? 'mine' : null,
  };
}

/** How many filters are on, which is what decides whether "clear" is offered. */
export function activeFilterCount(filters: DealFilters): number {
  return Object.values(filters).filter((value) => value !== null).length;
}

/**
 * The half-open range a month covers, as dates the database compares directly.
 *
 * Deliberately string arithmetic rather than `Date`: `cover_start_date` is a
 * `date`, the app runs on India time and the runner does not, and a month
 * boundary built through a `Date` is exactly where that difference shows up.
 */
export function monthRange(month: string): { from: string; to: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const nextYear = index === 12 ? year + 1 : year;
  const nextIndex = index === 12 ? 1 : index + 1;

  return {
    from: `${month}-01`,
    to: `${nextYear}-${String(nextIndex).padStart(2, '0')}-01`,
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "April 2027", for a month that is a string and must stay one. */
export function monthLabel(month: string): string {
  if (month === NO_MONTH) return 'No date set';
  const name = MONTHS[Number(month.slice(5, 7)) - 1];
  return name ? `${name} ${month.slice(0, 4)}` : month;
}

/**
 * The months to offer, newest first, taken from the deals themselves.
 *
 * A fixed range would offer months with nothing in them and miss a deal
 * starting outside it. `'none'` is included only when some deal really has no
 * cover start, so the option never promises an empty list.
 */
export function monthOptions(coverStarts: (string | null)[]): string[] {
  const months = new Set<string>();
  let anyMissing = false;

  for (const date of coverStarts) {
    if (!date) {
      anyMissing = true;
      continue;
    }
    months.add(date.slice(0, 7));
  }

  const sorted = [...months].sort();
  return anyMissing ? [...sorted, NO_MONTH] : sorted;
}
