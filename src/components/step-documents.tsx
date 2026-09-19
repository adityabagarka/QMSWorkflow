import { supabaseServer } from '@/lib/db/server';
import { REQUIRED_DOCUMENTS, type CaseDocument, type DocumentKind } from '@/lib/cases/documents';
import { DocumentSlot } from '@/app/deals/[id]/documents/document-panel';

/**
 * The upload slots for the documents a given step works from.
 *
 * The documents step is where the four are asked for together, but it is not
 * where they arrive. The claims MIS turns up weeks after the policy copy, and
 * by then the user is on the claims step — being told to go back to step 1 and
 * come forward again is a round trip for something that belongs right here
 * (ADR 0011: upload first, attach later where it was missed).
 *
 * Shown whether or not the document is held, because replacing a corrected
 * dump is as ordinary as adding a missing one.
 */
export async function StepDocuments({ dealId, kinds }: { dealId: string; kinds: DocumentKind[] }) {
  const supabase = supabaseServer();

  const { data } = await supabase
    .from('case_documents')
    .select('id, kind, file_name, byte_size, read_state, read_error, uploaded_at')
    .eq('case_id', dealId)
    .in('kind', kinds)
    .returns<CaseDocument[]>();

  const byKind = new Map((data ?? []).map((d) => [d.kind, d]));
  const specs = REQUIRED_DOCUMENTS.filter((s) => kinds.includes(s.kind));

  return (
    <div className="stepdocs">
      {specs.map((spec) => (
        <DocumentSlot
          key={spec.kind}
          dealId={dealId}
          spec={spec}
          document={byKind.get(spec.kind) ?? null}
        />
      ))}
    </div>
  );
}
