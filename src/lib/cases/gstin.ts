/**
 * GSTIN lookup.
 *
 * Reading the legal name, principal place of business and constitution from the
 * GSTN taxpayer record means the policy is issued in exactly the name the
 * insurer underwrites, rather than whatever someone typed into a form.
 *
 * Backed by fixtures, not the live GSTN API — the same approach as
 * `plum-quotes`. Two reasons: no GSTN credentials exist for this environment,
 * and CLAUDE.md forbids real company or personal data here at every milestone.
 * The shape of the response matches what a real lookup returns, so swapping in
 * the live call later is this one function.
 */
export type GstinFacts = {
  legalName: string;
  location: string;
  entityType: string;
  dateOfIncorporation: string | null;
};

const FIXTURES: Record<string, GstinFacts> = {
  '27AABCM1234N1Z5': {
    legalName: 'Meridian Logistics Pvt Ltd',
    location: 'Pune, Maharashtra',
    entityType: 'Pvt Ltd',
    dateOfIncorporation: '2012-06-14',
  },
  '29AAGCK5678P1Z2': {
    legalName: 'Kestrel Diagnostics Ltd',
    location: 'Bengaluru, Karnataka',
    entityType: 'Public Ltd',
    dateOfIncorporation: '2004-02-01',
  },
  '24AAFFS9012Q1Z8': {
    legalName: 'Sandbar Textiles LLP',
    location: 'Surat, Gujarat',
    entityType: 'LLP',
    dateOfIncorporation: '2016-11-23',
  },
};

export function lookupGstin(gstin: string): GstinFacts | null {
  return FIXTURES[gstin.trim().toUpperCase()] ?? null;
}

/** The fixtures, for the hint on the intake screen. */
export function sampleGstins(): string[] {
  return Object.keys(FIXTURES);
}

/** 15 characters: 2 state, 10 PAN, 1 entity, 1 'Z', 1 checksum. */
export function looksLikeGstin(value: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/.test(value.trim().toUpperCase());
}
