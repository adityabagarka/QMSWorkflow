import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireActiveSession } from '@/lib/auth/session';
import { supabaseServer } from '@/lib/db/server';
import { Masthead } from '@/components/masthead';
import { DealShell } from '@/components/deal-shell';
import { loadDealHeader } from '@/lib/cases/deal-header';
import { stageHref } from '@/lib/cases/phases';
import { formatCount, formatDate } from '@/lib/format';
import { summariseRoster } from '@/lib/parsing/roster';
import { previewRoster } from './actions';
import { RosterReview } from './roster-review';

const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Employees',
  spouse: 'Spouses',
  child: 'Children',
  parent: 'Parents',
  parent_in_law: 'Parents-in-law',
  sibling: 'Siblings',
};

type StoredMember = {
  relationship: string | null;
  gender: string | null;
  dob: string | null;
  age: number | null;
  employee_id: string | null;
  name_clean: string | null;
};

/** Step 3 — who is being quoted for. */
export default async function MembersStep({ params }: { params: { id: string } }) {
  const session = await requireActiveSession();
  const loaded = await loadDealHeader(params.id);
  if (!loaded) notFound();

  const { header, currentPhase } = loaded;
  const supabase = supabaseServer();

  const { data: stored } = await supabase
    .from('member_records')
    .select('relationship, gender, dob, age, employee_id, name_clean')
    .eq('case_id', params.id)
    .returns<StoredMember[]>();

  const members = stored ?? [];
  const isLoaded = members.length > 0;

  // Only read the file when there is nothing loaded yet: once a roster has been
  // committed, the database is the answer and re-parsing on every page view
  // would be work done to tell us what we already know.
  const preview = isLoaded ? null : await previewRoster(params.id);

  const summary = isLoaded
    ? summariseRoster(
        members.map((m) => ({
          rowNumber: 0,
          employeeId: m.employee_id,
          name: m.name_clean,
          relationship: (m.relationship ?? null) as never,
          gender: (m.gender ?? null) as never,
          dob: m.dob,
          age: m.age,
          sumInsured: null,
          joinedOn: null,
        })),
      )
    : null;

  return (
    <main className="shell">
      <Masthead
        user={session}
        dealTitle={header.customer_name}
        dealRef={header.deal_type === 'renewal' ? 'Renewal' : 'Rollover'}
      />
      <DealShell
        deal={header}
        currentPhase={2}
        maxReachedPhase={Math.max(currentPhase, 3)}
        title="Members"
        back={stageHref(header.id, 1)}
        next={stageHref(header.id, 3)}
        nextLabel="claims"
      >
        {isLoaded && summary ? (
          <div>
            <p className="standfirst">
              {formatCount(summary.lives)} lives, as at{' '}
              {formatDate(header.cover_start_date) === '—'
                ? 'today'
                : formatDate(header.cover_start_date)}
              .
            </p>

            <div className="demog">
              {Object.entries(summary.byRelationship).map(([relationship, count]) => (
                <div key={relationship} className="demog__stat">
                  <span className="label">{RELATIONSHIP_LABELS[relationship] ?? relationship}</span>
                  <span className="figure">{formatCount(count)}</span>
                </div>
              ))}
              <div className="demog__stat">
                <span className="label">Average age</span>
                <span className="figure">{summary.averageAge ?? '—'}</span>
              </div>
            </div>

            <table className="bandtable">
              <thead>
                <tr>
                  <th>Age band</th>
                  <th>Lives</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(summary.byAgeBand).map(([band, count]) => (
                  <tr key={band}>
                    <td>{band}</td>
                    <td>{formatCount(count)}</td>
                    <td className="cell-muted">
                      {Math.round((count / Math.max(summary.lives, 1)) * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {summary.withoutAge > 0 ? (
              <p className="ff__hint" style={{ marginTop: 16 }}>
                {formatCount(summary.withoutAge)} of them have no age, so they are not in the bands
                above.
              </p>
            ) : null}

            <p style={{ marginTop: 28 }}>
              <Link href={stageHref(header.id, 0)}>Upload a corrected roster</Link> to replace this.
            </p>
          </div>
        ) : preview?.ok ? (
          <RosterReview
            dealId={params.id}
            result={preview.result}
            headers={preview.headers}
            fileName={preview.fileName}
            asOfLabel={
              header.cover_start_date
                ? formatDate(header.cover_start_date)
                : 'today, pending a cover start date'
            }
          />
        ) : (
          <div className="notice">
            <p style={{ margin: 0 }}>
              {preview?.message ?? 'No member data has been uploaded yet.'}
            </p>
            <p style={{ margin: '10px 0 0' }}>
              <Link href={stageHref(header.id, 0)}>Go to documents</Link> to add it.
            </p>
          </div>
        )}
      </DealShell>
    </main>
  );
}
