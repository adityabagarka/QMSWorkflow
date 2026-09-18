/**
 * Cover starts the day after the expiring policy ends.
 *
 * That is what continuity means, so the date is derived rather than asked for.
 * It stays editable, because cover genuinely does start elsewhere — the client
 * shifts it, a gap gets accepted, the incumbent extends by a month — and a
 * derived field that cannot be corrected is one that will be wrong with no way
 * of saying so.
 *
 * A shift has to say why, and the reason is a vocabulary rather than a note,
 * because why a programme moved is a fact about the customer worth counting
 * across deals. Prose cannot be counted.
 */

/** Must match the check constraint in migration 0027. */
export const COVER_START_CHANGE_REASONS = {
  client_requested_later: 'Client asked to start later',
  client_requested_earlier: 'Client asked to start earlier',
  gap_accepted: 'Client accepted a gap in cover',
  aligning_to_financial_year: 'Aligning to their financial year',
  incumbent_extended: 'Incumbent extended the expiring policy',
  awaiting_member_data: 'Waiting on member data',
  negotiation_ongoing: 'Terms not agreed in time',
  other: 'Something else',
} as const;

export type CoverStartChangeReason = keyof typeof COVER_START_CHANGE_REASONS;

export function isCoverStartChangeReason(value: string): value is CoverStartChangeReason {
  return Object.prototype.hasOwnProperty.call(COVER_START_CHANGE_REASONS, value);
}

/** The reason that needs a note beside it, because on its own it says nothing. */
export const REASON_REQUIRING_NOTE: CoverStartChangeReason = 'other';

/**
 * The day after `policyEnd`, as "YYYY-MM-DD".
 *
 * Date arithmetic in UTC deliberately: the input is a calendar day with no time
 * of day, and adding a day to it is calendar arithmetic. Running it through a
 * zone would risk landing on the wrong side of midnight (see TIME_ZONE in
 * src/lib/format.ts for why that is not theoretical here).
 */
export function deriveCoverStart(policyEnd: string | null | undefined): string | null {
  if (!policyEnd || !/^\d{4}-\d{2}-\d{2}$/.test(policyEnd)) return null;

  const next = new Date(`${policyEnd}T00:00:00Z`);
  if (Number.isNaN(next.getTime())) return null;

  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

export type CoverStartInput = {
  coverStart: string | null;
  derived: string | null;
  reason: string | null;
  note: string | null;
};

export type CoverStartResolved = {
  cover_start_date: string | null;
  cover_start_derived_date: string | null;
  cover_start_change_reason: CoverStartChangeReason | null;
  cover_start_change_note: string | null;
};

/**
 * Validates a cover start against its derivation, mirroring the three check
 * constraints in migration 0027.
 *
 * Checked here as well as in the database so the person gets a sentence rather
 * than a constraint violation. The database remains the thing that decides:
 * this can be bypassed, that cannot.
 */
export function resolveCoverStart(
  input: CoverStartInput,
): { ok: true; value: CoverStartResolved } | { ok: false; message: string } {
  const coverStart = input.coverStart?.trim() || null;
  const derived = input.derived?.trim() || null;
  const note = input.note?.trim() || null;
  const rawReason = input.reason?.trim() || null;

  const shifted = coverStart !== null && derived !== null && coverStart !== derived;

  if (!shifted) {
    // Not a shift, so any reason left over from an earlier edit is cleared
    // rather than kept — a reason explaining a change that no longer exists is
    // worse than none, because it reads as current.
    return {
      ok: true,
      value: {
        cover_start_date: coverStart,
        cover_start_derived_date: derived,
        cover_start_change_reason: null,
        cover_start_change_note: null,
      },
    };
  }

  if (!rawReason) {
    return {
      ok: false,
      message: 'Cover is not starting the day after the policy expires — say why.',
    };
  }

  if (!isCoverStartChangeReason(rawReason)) {
    return { ok: false, message: 'Choose one of the listed reasons.' };
  }

  if (rawReason === REASON_REQUIRING_NOTE && !note) {
    return { ok: false, message: 'Add a line saying what the reason was.' };
  }

  return {
    ok: true,
    value: {
      cover_start_date: coverStart,
      cover_start_derived_date: derived,
      cover_start_change_reason: rawReason,
      cover_start_change_note: note,
    },
  };
}
