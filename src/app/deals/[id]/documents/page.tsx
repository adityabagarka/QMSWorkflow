import { redirect } from 'next/navigation';

/**
 * The documents step is now part of step 1 (ADR 0013).
 *
 * Kept as a redirect rather than deleted: this path is in browser histories and
 * in links the app itself wrote before the merge, and a 404 for a deal that
 * plainly exists is a worse answer than taking somebody where the documents
 * actually are.
 */
export default function DocumentsStep({ params }: { params: { id: string } }) {
  redirect(`/deals/${params.id}`);
}
