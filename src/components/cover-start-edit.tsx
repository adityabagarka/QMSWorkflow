'use client';

import { useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import { Field, FieldRow, Input, Select } from '@/components/form';
import { COVER_START_CHANGE_REASONS } from '@/lib/cases/cover-start';
import { formatDate } from '@/lib/format';
import { shiftCoverStart, type ShiftResult } from '@/app/deals/[id]/cover-start-actions';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button className="button" type="submit" disabled={pending}>
      {pending ? 'saving…' : 'save'}
    </button>
  );
}

/**
 * The cover start date, with a way to move it.
 *
 * Read-only by default, because it is derived and almost always right. The
 * pencil is the whole affordance: the date is the thing on this screen somebody
 * occasionally needs to change, and a form field for it on every deal would ask
 * a question already answered by the expiry date.
 *
 * Moving it asks why, from a fixed vocabulary — a free-text note would be
 * unreadable in aggregate, and the aggregate is the reason for asking.
 */
export function CoverStartEdit({
  dealId,
  coverStart,
  derived,
  chip,
  reason,
  note,
}: {
  dealId: string;
  coverStart: string | null;
  derived: string | null;
  chip: { className: string; label: string };
  reason: string | null;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [result, submit] = useFormState<ShiftResult, FormData>(
    shiftCoverStart.bind(null, dealId),
    null,
  );
  const [date, setDate] = useState(coverStart ?? '');
  const [why, setWhy] = useState(reason ?? '');

  const shifted = Boolean(date && derived && date !== derived);

  if (!open) {
    return (
      <>
        <span className="figure">
          {formatDate(coverStart)}
          <button
            className="summary__edit"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Change when cover starts"
            title="Change when cover starts"
          >
            ✎
          </button>
        </span>
        <span className="under">
          <span className={chip.className}>{chip.label}</span>
          {reason ? (
            <span className="summary__reason">
              {COVER_START_CHANGE_REASONS[reason as keyof typeof COVER_START_CHANGE_REASONS] ??
                reason}
            </span>
          ) : null}
        </span>
      </>
    );
  }

  return (
    <form className="coverstart" action={submit}>
      <FieldRow>
        <Field label="Cover starts">
          <Input
            type="date"
            name="cover_start_date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
      </FieldRow>

      {shifted ? (
        <>
          <FieldRow>
            <Field label="Why" wide>
              <Select
                name="cover_start_change_reason"
                options={Object.entries(COVER_START_CHANGE_REASONS).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                required
              />
            </Field>
          </FieldRow>

          {why === 'other' ? (
            <FieldRow>
              <Field label="What happened?" wide>
                <Input name="cover_start_change_note" defaultValue={note ?? ''} required />
              </Field>
            </FieldRow>
          ) : null}
        </>
      ) : null}

      {result && !result.ok ? <p className="terms__error">{result.message}</p> : null}

      <div className="coverstart__actions">
        <SaveButton />
        <button className="linkish" type="button" onClick={() => setOpen(false)}>
          cancel
        </button>
      </div>
    </form>
  );
}
