/**
 * What the policy fill would write, decided before anything is written.
 *
 * Kept apart from the action for two reasons. A `'use server'` module may only
 * export async functions, so a pure decision cannot live there; and the rules
 * below — which field a reading belongs to, what counts as already filled, what
 * is refused outright — are exactly the part worth testing without a database
 * (`npm run test:policy-fill`).
 */

/** What the reader calls a fact, against where it lives on the deal. */
export const CUSTOMER_FIELDS = {
  policyholderName: 'legal_name',
  gstin: 'gstin',
  location: 'location',
} as const;

export const POLICY_FIELDS = {
  insurerName: 'insurer_name',
  brokerName: 'broker_name',
  tpaName: 'tpa_name',
  premium: 'expiring_premium',
} as const;

const GSTIN_SHAPED = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z][0-9A-Za-z]{3}$/;

export type ReadValue = { value: string; page: number };

/** What the deal already holds, so nothing a person entered is overwritten. */
export type Held = {
  legal_name: string | null;
  gstin: string | null;
  location: string | null;
  insurer_name: string | null;
  broker_name: string | null;
  tpa_name: string | null;
  expiring_premium: number | null;
  policy_expiry_date: string | null;
};

export type Reading = {
  field: string;
  read_value: string;
  read_page: number;
  saved_value: string | null;
};

export type Plan = {
  customerPatch: Record<string, string>;
  policyPatch: Record<string, string>;
  expiry: string | null;
  readings: Reading[];
  filled: number;
};

/**
 * The plan.
 *
 * `values` is what the reader found, already resolved against the insurer, TPA
 * and broker lists — resolution needs the database, the rest does not.
 */
export function planPolicyFill(values: Record<string, ReadValue>, held: Held): Plan {
  const customerPatch: Record<string, string> = {};
  const policyPatch: Record<string, string> = {};
  const readings: Reading[] = [];
  let expiry: string | null = null;
  let filled = 0;

  for (const [key, read] of Object.entries(values)) {
    if (!read) continue;

    const customerField = CUSTOMER_FIELDS[key as keyof typeof CUSTOMER_FIELDS];
    const policyField = POLICY_FIELDS[key as keyof typeof POLICY_FIELDS];
    const isExpiry = key === 'policyEnd';
    if (!customerField && !policyField && !isExpiry) continue;

    /*
     * A legal name that is really a GSTIN is refused everywhere else (0028),
     * and the reader can produce one where a schedule prints the two together.
     */
    if (customerField === 'legal_name' && GSTIN_SHAPED.test(read.value)) continue;

    const column = customerField ?? policyField ?? 'policy_expiry_date';
    const current = isExpiry
      ? held.policy_expiry_date
      : ((held[column as keyof Held] ?? null) as string | number | null);

    const empty = current === null || current === undefined || !String(current).trim();

    if (empty) {
      if (customerField) customerPatch[customerField] = read.value;
      if (policyField) policyPatch[policyField] = read.value;
      if (isExpiry) expiry = read.value;
      filled += 1;
    }

    readings.push({
      field: column,
      read_value: read.value,
      read_page: read.page,
      saved_value: empty ? read.value : String(current),
    });
  }

  return { customerPatch, policyPatch, expiry, readings, filled };
}

/**
 * The first write that did not happen.
 *
 * Every one of these used to be fired and forgotten. When the `policies` update
 * failed, the customer patch still landed, the readings were still written and
 * the activity still said "policy read", while insurer, broker, TPA and premium
 * stayed empty on the deal — and because the readings are what stops the fill
 * running twice, the failure was permanent.
 */
export function firstWriteError(
  writes: [string, { error: { message: string } | null }][],
): { table: string; message: string } | null {
  for (const [table, result] of writes) {
    if (result.error) return { table, message: result.error.message };
  }
  return null;
}
