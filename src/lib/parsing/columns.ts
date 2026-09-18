/**
 * Matching the headers a file arrived with to the fields we need.
 *
 * There is no standard roster. "Employee ID" is also "Emp Code", "EMP_ID",
 * "Staff No" and "Employee Number"; a date of birth is "DOB", "D.O.B", "Birth
 * Date" or "Date Of Birth". Guessing well covers most files; the rest need a
 * person to say which column is which, so every guess is returned with what it
 * matched on and how confident it is, and the mapping stays overridable.
 */
import { normaliseHeader, type Sheet } from './sheet';

export type FieldSpec = {
  field: string;
  label: string;
  /** Matched in order; the first hit wins, so put the specific ones first. */
  patterns: RegExp[];
  required?: boolean;
};

export type ColumnMatch = {
  field: string;
  /** The header as it appears in the file, or null when nothing matched. */
  header: string | null;
  confidence: 'exact' | 'likely' | 'none';
};

export type Mapping = {
  matches: ColumnMatch[];
  /** Headers in the file that nothing claimed — shown so a miss is visible. */
  unmatched: string[];
};

/** The roster fields. Only a relationship is genuinely required. */
export const MEMBER_FIELDS: FieldSpec[] = [
  {
    field: 'employee_id',
    label: 'Employee ID',
    patterns: [/^emp(loyee)?\s*(id|code|no|number)$/, /^staff\s*(id|no|code)$/, /^emp\b/],
  },
  {
    field: 'name',
    label: 'Name',
    patterns: [
      /^(member|employee|insured|beneficiary)?\s*name$/,
      /^name of (the )?(member|employee|insured)$/,
      /\bname\b/,
    ],
  },
  {
    field: 'relationship',
    label: 'Relationship',
    patterns: [/^relation(ship)?$/, /relation.*employee/, /^dependent\s*type$/, /^relation/],
    required: true,
  },
  {
    field: 'dob',
    label: 'Date of birth',
    patterns: [/^d\.?o\.?b\.?$/, /date of birth/, /^birth\s*date$/, /\bdob\b/],
  },
  { field: 'gender', label: 'Gender', patterns: [/^gender$/, /^sex$/, /^m\/f$/] },
  { field: 'age', label: 'Age', patterns: [/^age$/, /^age\s*(in\s*)?(years|yrs)$/] },
  {
    field: 'sum_insured',
    label: 'Sum insured',
    patterns: [/^sum\s*insured$/, /^s\.?i\.?$/, /^si\s*amount$/, /sum insured/],
  },
  {
    field: 'joined_on',
    label: 'Date of joining',
    patterns: [/^d\.?o\.?j\.?$/, /date of joining/, /^joining\s*date$/, /^enrol(l)?ment date$/],
  },
];

/** The claim-level fields a dump is read for. */
export const CLAIM_FIELDS: FieldSpec[] = [
  {
    field: 'claim_ref',
    label: 'Claim number',
    patterns: [/^claim\s*(no|number|id|ref)$/, /\bclaim.*(no|id)\b/],
  },
  {
    field: 'member_ref',
    label: 'Member',
    patterns: [/^(member|employee|patient|insured)\s*(id|code|name|no)$/, /\b(member|employee)\b/],
  },
  {
    field: 'relationship',
    label: 'Relationship',
    patterns: [/^relation(ship)?$/, /^dependent\s*type$/],
  },
  {
    field: 'claim_type',
    label: 'Claim type',
    patterns: [/^claim\s*type$/, /^type$/, /cashless|reimburse/],
  },
  { field: 'status', label: 'Status', patterns: [/^(claim\s*)?status$/, /^settlement\s*status$/] },
  {
    field: 'incurred_on',
    label: 'Date of admission',
    patterns: [/admission/, /^incurred?\s*(on|date)$/, /^date of loss$/, /^claim\s*date$/],
  },
  {
    field: 'reported_on',
    label: 'Date reported',
    patterns: [/report(ed)?\s*(on|date)/, /intimation/],
  },
  {
    field: 'claimed_amount',
    label: 'Amount claimed',
    patterns: [/^claim(ed)?\s*amount$/, /^amount\s*claimed$/, /^billed/],
  },
  {
    field: 'paid_amount',
    label: 'Amount paid',
    patterns: [
      /^(paid|settled|approved)\s*amount$/,
      /^amount\s*(paid|settled)$/,
      /^settlement\s*amount$/,
    ],
  },
  {
    field: 'diagnosis',
    label: 'Diagnosis',
    patterns: [/^diagnosis$/, /^ailment$/, /^disease$/, /^nature of (illness|ailment)$/],
  },
];

/**
 * Matches headers to fields.
 *
 * A header is claimed by at most one field, and a field takes at most one
 * header: without that, "Employee Name" satisfies both `employee_id` and
 * `name`, and the roster reads every member as their own employee number.
 * Exact matches are settled first across all fields for the same reason —
 * otherwise a loose pattern early in the list takes a header that a later
 * field names precisely.
 */
export function matchColumns(headers: string[], fields: FieldSpec[]): Mapping {
  const normalised = headers.map((h) => ({ header: h, key: normaliseHeader(h) }));
  const taken = new Set<string>();
  const matches = new Map<string, ColumnMatch>();

  // Pass one: a pattern anchored at both ends is a name, not a guess.
  for (const spec of fields) {
    const exact = spec.patterns.filter((p) => p.source.startsWith('^') && p.source.endsWith('$'));
    const hit = normalised.find((h) => !taken.has(h.header) && exact.some((p) => p.test(h.key)));
    if (hit) {
      taken.add(hit.header);
      matches.set(spec.field, { field: spec.field, header: hit.header, confidence: 'exact' });
    }
  }

  // Pass two: anything still unclaimed, on the looser patterns.
  for (const spec of fields) {
    if (matches.has(spec.field)) continue;
    const hit = normalised.find(
      (h) => !taken.has(h.header) && spec.patterns.some((p) => p.test(h.key)),
    );
    if (hit) {
      taken.add(hit.header);
      matches.set(spec.field, { field: spec.field, header: hit.header, confidence: 'likely' });
    }
  }

  return {
    matches: fields.map(
      (spec) => matches.get(spec.field) ?? { field: spec.field, header: null, confidence: 'none' },
    ),
    unmatched: headers.filter((h) => !taken.has(h)),
  };
}

/** Reads a field out of a row through the mapping, or null if unmapped. */
export function valueFor(row: Record<string, unknown>, mapping: Mapping, field: string): unknown {
  const match = mapping.matches.find((m) => m.field === field);
  if (!match?.header) return null;
  return row[match.header] ?? null;
}

/** Which required fields nothing matched — what a person has to map by hand. */
export function unmappedRequired(mapping: Mapping, fields: FieldSpec[]): FieldSpec[] {
  return fields.filter(
    (spec) => spec.required && !mapping.matches.find((m) => m.field === spec.field)?.header,
  );
}

/** Applies a person's corrections over the guesses. */
export function overrideMapping(
  mapping: Mapping,
  overrides: Record<string, string | null>,
): Mapping {
  const matches = mapping.matches.map((m) =>
    Object.prototype.hasOwnProperty.call(overrides, m.field)
      ? { ...m, header: overrides[m.field] ?? null, confidence: 'exact' as const }
      : m,
  );
  const taken = new Set(matches.map((m) => m.header).filter((h): h is string => Boolean(h)));

  return {
    matches,
    unmatched: [...mapping.unmatched, ...mapping.matches.map((m) => m.header)]
      .filter((h): h is string => Boolean(h))
      .filter((h, i, all) => !taken.has(h) && all.indexOf(h) === i),
  };
}

export function describeSheet(sheet: Sheet): string {
  return `${sheet.rows.length} rows, headers on row ${sheet.headerRow}`;
}
