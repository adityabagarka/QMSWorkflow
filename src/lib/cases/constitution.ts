/**
 * Reading a company's constitution off its legal name.
 *
 * Indian company names carry their form in the suffix, and the Companies Act
 * requires it — "Private Limited", "LLP", "OPC". So a user who has typed the
 * legal name has already answered this question, and asking it again is a
 * field they fill in to say what they just said.
 *
 * Only the forms whose suffix is unambiguous are derived. Proprietorship,
 * partnership, trust and foreign company do not announce themselves in a name,
 * and guessing at those would be worse than leaving the field for the user:
 * a wrong constitution is carried into the RFQ and onto the policy.
 */

/** Order matters: the longest, most specific suffix has to be tried first. */
const SUFFIXES: { pattern: RegExp; entityType: string }[] = [
  // OPC before Private Limited — "(OPC) Private Limited" is the registered form.
  { pattern: /\bopc\b/i, entityType: 'One person company' },
  { pattern: /\bone\s+person\s+company\b/i, entityType: 'One person company' },

  { pattern: /\bllp\b/i, entityType: 'LLP' },
  { pattern: /\blimited\s+liability\s+partnership\b/i, entityType: 'LLP' },

  // Private before public: "Private Limited" contains "Limited".
  { pattern: /\b(pvt|private)\b[\s.]*\b(ltd|limited)\b/i, entityType: 'Pvt Ltd' },
  { pattern: /\b(ltd|limited)\b/i, entityType: 'Public Ltd' },
];

/**
 * The constitution a legal name implies, or null where it implies none.
 *
 * Null is a real answer here — it means the user has to choose — so callers
 * must not treat it as "leave what was there".
 */
export function constitutionFromLegalName(legalName: string): string | null {
  const name = legalName.trim();
  if (name.length < 3) return null;

  for (const { pattern, entityType } of SUFFIXES) {
    if (pattern.test(name)) return entityType;
  }
  return null;
}
