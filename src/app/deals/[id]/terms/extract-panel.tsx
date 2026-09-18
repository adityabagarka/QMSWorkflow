'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { readPolicyCopy, type ExtractionSummary } from './actions';

function ReadButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'reading the policy…' : again ? 'read it again' : 'read the policy copy'}
    </button>
  );
}

/**
 * Runs the reader over the uploaded policy copy.
 *
 * Deliberately a button rather than something that fires on upload. Reading a
 * policy costs money and takes a minute, and the person who uploaded it may not
 * be the person who works the terms — so it happens when somebody asks for it,
 * on the screen where the result is used.
 */
export function ExtractPanel({
  dealId,
  fileName,
  configured,
  alreadyRead,
}: {
  dealId: string;
  fileName: string | null;
  configured: boolean;
  alreadyRead: boolean;
}) {
  const [result, submit] = useFormState<ExtractionSummary, FormData>(
    (prev: ExtractionSummary) => readPolicyCopy(dealId, prev),
    null,
  );

  if (!fileName) {
    return (
      <div className="extract extract--quiet">
        No policy copy uploaded. Add one at the documents step and it can be read here; until then
        the terms are entered by hand.
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="extract extract--quiet">
        Reading policies is not switched on in this environment, so the terms below are entered by
        hand. Nothing else about this step changes.
      </div>
    );
  }

  return (
    <div className="extract">
      <div className="extract__row">
        <div>
          <div className="extract__what">{fileName}</div>
          <div className="extract__why">
            Every value comes back with the clause it was read from, and none of them count until
            you confirm them.
          </div>
        </div>
        <form action={submit}>
          <ReadButton again={alreadyRead} />
        </form>
      </div>

      {result && !result.ok ? <p className="extract__bad">{result.message}</p> : null}

      {result && result.ok ? (
        <div className="extract__done">
          <p>
            {result.proposed} proposed, {result.notStated} not stated in the policy. Confirm or
            correct each one below.
          </p>

          {result.disagreements.length > 0 ? (
            <div className="extract__clash">
              <p>
                {result.disagreements.length} term
                {result.disagreements.length === 1 ? '' : 's'} you already reviewed read differently
                in the policy. Your values are kept — these are for a second look.
              </p>
              <ul>
                {result.disagreements.map((d) => (
                  <li key={d.benefit}>
                    <span className="extract__key">{d.benefit}</span>
                    <span>
                      yours: {d.reviewed ?? '—'} · policy: {d.read}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
