'use client';

import { useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import {
  describeReadState,
  formatBytes,
  type CaseDocument,
  type DocumentSpec,
} from '@/lib/cases/documents';
import { formatDate } from '@/lib/format';
import { removeDocument, uploadDocument, type UploadResult } from './actions';

/** Says what is happening to the file that was just chosen. */
function Uploading({ name }: { name: string }) {
  const { pending } = useFormStatus();
  if (!name) return null;
  return <span className="docslot__chosen">{pending ? `uploading ${name}…` : name}</span>;
}

/**
 * One document slot.
 *
 * Deliberately not a drop zone with a list inside it: each of the four is a
 * named thing the deal needs, and showing all four as slots — filled or not —
 * says what is outstanding without anybody having to remember the list.
 */
export function DocumentSlot({
  dealId,
  spec,
  document,
}: {
  dealId: string;
  spec: DocumentSpec;
  document: CaseDocument | null;
}) {
  const [result, submit] = useFormState<UploadResult, FormData>(
    uploadDocument.bind(null, dealId),
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [fileName, setFileName] = useState('');

  const filled = Boolean(document);

  return (
    <div className={filled ? 'docslot docslot--filled' : 'docslot'}>
      <div className="docslot__head">
        <div>
          <div className="docslot__label">{spec.label}</div>
        </div>
        {filled ? <span className="chip chip--settled">held</span> : null}
      </div>

      {document ? (
        <div className="docslot__file">
          <div>
            <div className="docslot__name">{document.file_name}</div>
            <div className="docslot__meta">
              {[
                formatBytes(document.byte_size),
                describeReadState(document),
                formatDate(document.uploaded_at),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <form action={removeDocument.bind(null, dealId, document.id)}>
            <button className="linkish" type="submit">
              remove
            </button>
          </form>
        </div>
      ) : null}

      {/*
        Uploading starts the moment a file is chosen. There was an "upload"
        button after it, which is a second instruction for a decision already
        made — nobody picks a file they did not mean to send, and the slot is
        the thing that says whether it arrived.
      */}
      <form action={submit} ref={formRef}>
        <input type="hidden" name="kind" value={spec.kind} />
        <label className="docslot__pick">
          <input
            type="file"
            name="file"
            accept={spec.accept}
            onChange={(e) => {
              setFileName(e.target.files?.[0]?.name ?? '');
              if (e.target.files?.length) formRef.current?.requestSubmit();
            }}
          />
          <span className="button button--secondary">
            {filled ? 'replace this file' : 'choose a file'}
          </span>
          <Uploading name={fileName} />
        </label>
      </form>

      {result && !result.ok ? <p className="docslot__error">{result.message}</p> : null}
    </div>
  );
}
