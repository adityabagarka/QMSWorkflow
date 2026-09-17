'use client';

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * The expiring policy, rendered beside the terms grid.
 *
 * The file is fetched through a short-lived signed URL rather than a public
 * one: the bucket is private, and access is decided by the same span rules as
 * the deal itself (migration 0016). A URL that outlived the session would be a
 * way around that.
 */
export function PolicyPanel({ caseId, fileRef }: { caseId: string; fileRef: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileRef || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    let cancelled = false;
    const supabase = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    supabase.storage
      .from('case-documents')
      .createSignedUrl(fileRef, 600)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setUrl(data?.signedUrl ?? null);
      });

    return () => {
      cancelled = true;
    };
  }, [fileRef, caseId]);

  if (!fileRef) {
    return (
      <div className="pdf-panel">
        <div className="pdf-panel__empty">
          No policy copy uploaded yet. Add one at the expiring policy step and it will show here
          while you work through the terms.
        </div>
      </div>
    );
  }

  return (
    <div className="pdf-panel">
      <div className="pdf-panel__bar">
        <span>{fileRef.split('/').pop()}</span>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            open
          </a>
        ) : null}
      </div>
      {error ? (
        <div className="pdf-panel__empty">Could not open the policy: {error}</div>
      ) : url ? (
        <iframe className="pdf-panel__frame" src={url} title="Expiring policy" />
      ) : (
        <div className="pdf-panel__empty">Opening…</div>
      )}
    </div>
  );
}
