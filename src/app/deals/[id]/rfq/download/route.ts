import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { assembleRfq } from '@/lib/rfq/assemble';
import { buildRfqWorkbook, workbookName } from '@/lib/rfq/workbook';

/**
 * The RFQ as a spreadsheet.
 *
 * A route rather than a server action because the answer is a file: the browser
 * downloads it, and nothing needs to re-render.
 *
 * Access is the deal's own. `assembleRfq` reads through the RLS-bound client,
 * so a deal outside the caller's span assembles to nothing and this 404s —
 * indistinguishable from a deal that does not exist, which is the right answer
 * (§15).
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const session = await getSession();
  if (!session || session.status !== 'active') {
    return NextResponse.json({ error: 'Not permitted.' }, { status: 403 });
  }

  const optionId = new URL(request.url).searchParams.get('option') ?? undefined;
  const rfq = await assembleRfq(params.id, optionId);
  if (!rfq) return NextResponse.json({ error: 'No such deal.' }, { status: 404 });

  const workbook = await buildRfqWorkbook(rfq);

  return new NextResponse(workbook as unknown as BodyInit, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${workbookName(rfq)}"`,
      // It is assembled per request from live data, so caching it would serve
      // yesterday's terms to somebody who just corrected one.
      'cache-control': 'no-store',
    },
  });
}
