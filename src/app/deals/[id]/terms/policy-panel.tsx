'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { currentPolicyPage, goToPolicyPage, watchPolicyPage } from './policy-view';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The expiring policy, rendered beside the terms it describes.
 *
 * The file is fetched through a short-lived signed URL rather than a public
 * one: the bucket is private, and access is decided by the same span rules as
 * the deal itself (migration 0016). A URL that outlived the session would be a
 * way around that.
 *
 * Page navigation is the point. The panel used to be an iframe pinned to page
 * one of a sixty-page document, which is a picture of a policy rather than a
 * way to read one — the only way to reach page 12 was to open the file in
 * another tab, which is the trip this panel exists to avoid. The viewer takes a
 * page number, so the controls here and the "page 12" on a proposed term both
 * drive the same thing.
 */
export function PolicyPanel({
  fileRef,
  fileName,
}: {
  fileRef: string | null;
  fileName: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(currentPolicyPage());

  useEffect(() => watchPolicyPage(setPage), []);

  useEffect(() => {
    if (!fileRef || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    let cancelled = false;
    const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    supabase.storage
      .from('case-documents')
      .createSignedUrl(fileRef, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setUrl(data?.signedUrl ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileRef]);

  if (!fileRef) {
    return (
      <div className="pdf-panel">
        <div className="pdf-panel__empty">No policy copy uploaded.</div>
      </div>
    );
  }

  return (
    <div className="pdf-panel">
      <div className="pdf-panel__bar">
        <span className="pdf-panel__name">{fileName ?? fileRef.split('/').pop()}</span>

        <span className="pdf-panel__pager">
          <button
            type="button"
            onClick={() => goToPolicyPage(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            ‹
          </button>
          <input
            type="number"
            min={1}
            value={page}
            onChange={(e) => goToPolicyPage(Number(e.target.value))}
            aria-label="Page"
          />
          <button type="button" onClick={() => goToPolicyPage(page + 1)} aria-label="Next page">
            ›
          </button>
        </span>

        {url ? (
          <a href={`${url}#page=${page}`} target="_blank" rel="noreferrer">
            open
          </a>
        ) : null}
      </div>

      {error ? (
        <div className="pdf-panel__empty">Could not open the policy: {error}</div>
      ) : url ? (
        /*
         * Keyed on the page so React remounts the frame. A fragment change
         * alone does not move the browser's PDF viewer once it has loaded, so
         * without this the controls would move the number and nothing else.
         */
        <iframe
          key={page}
          className="pdf-panel__frame"
          src={`${url}#page=${page}&view=FitH`}
          title="Expiring policy"
        />
      ) : (
        <div className="pdf-panel__empty">Opening…</div>
      )}
    </div>
  );
}
