/**
 * The four documents a rollover is built from (ADR 0011).
 *
 * Every one of them is optional at intake and all four are required to dispatch
 * an RFQ. That asymmetry is the whole design: the documents do not arrive
 * together — the policy copy usually comes first and an insurer's claims MIS
 * can take weeks — so demanding them up front would block a deal on whichever
 * one is slowest, while an insurer genuinely cannot quote a programme whose
 * member data nobody has seen.
 */

export type DocumentKind = 'policy_copy' | 'member_data' | 'claims_dump' | 'claims_mis' | 'other';

export type DocumentSpec = {
  kind: DocumentKind;
  label: string;
  /** What it is for, in terms of what the RM gets out of it. */
  purpose: string;
  accept: string;
};

/** In the order they are asked for, which is roughly the order they arrive. */
export const REQUIRED_DOCUMENTS: DocumentSpec[] = [
  {
    kind: 'policy_copy',
    label: 'Expiring policy copy',
    purpose: 'The terms being rolled over, and the incumbent insurer, broker and premium.',
    accept: '.pdf,image/png,image/jpeg',
  },
  {
    kind: 'member_data',
    label: 'Member data',
    purpose: 'Who is covered, and the demography the rates are built on.',
    accept: '.csv,.xls,.xlsx',
  },
  {
    kind: 'claims_dump',
    label: 'Claims dump',
    purpose: 'Claim-level history, which is what the burn is computed from.',
    accept: '.csv,.xls,.xlsx',
  },
  {
    kind: 'claims_mis',
    label: 'Claims MIS',
    purpose: "The insurer's own summary, to read against the dump.",
    accept: '.csv,.xls,.xlsx,.pdf',
  },
];

export const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  policy_copy: 'Expiring policy copy',
  member_data: 'Member data',
  claims_dump: 'Claims dump',
  claims_mis: 'Claims MIS',
  other: 'Supporting document',
};

export type ReadState = 'uploaded' | 'reading' | 'read' | 'empty' | 'failed';

export type CaseDocument = {
  id: string;
  kind: DocumentKind;
  file_name: string;
  byte_size: number | null;
  read_state: ReadState;
  read_error: string | null;
  uploaded_at: string;
};

/**
 * Where a file lives in the bucket.
 *
 * `cases/<case id>/…` is not a convention, it is the access rule: the storage
 * policies in migration 0016 read the case id out of the second path segment
 * and check it against the same span model as the case itself. A file stored
 * anywhere else is unreachable rather than public, but it is still wrong.
 */
export function storagePath(caseId: string, kind: DocumentKind, fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-120);
  return `cases/${caseId}/${kind}/${Date.now()}-${safe}`;
}

/** Bytes as a person reads them. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the document panel says about a file, once it is stored. */
export function describeReadState(doc: CaseDocument): string {
  switch (doc.read_state) {
    case 'reading':
      return 'Reading…';
    case 'read':
      return 'Read';
    case 'empty':
      return 'Nothing found in it';
    case 'failed':
      return doc.read_error ?? 'Could not be read';
    default:
      return 'Stored';
  }
}
