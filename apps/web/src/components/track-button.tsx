'use client';

import Link from 'next/link';
import { useState } from 'react';
import { callApi, errorMessage } from '@/lib/client-api';
import { Icon } from './ui';

/** "Track application": creates a tracker record from the opportunity (with a snapshot of its details). */
export function TrackButton({
  opportunityId,
  signedIn,
  locale,
  nextPath,
  initialTrackedId,
  labels,
  errors,
}: {
  opportunityId: string;
  signedIn: boolean;
  locale: string;
  nextPath: string;
  initialTrackedId: string | null;
  labels: { track: string; tracking: string; signIn: string };
  errors: Record<string, string>;
}) {
  const [trackedId, setTrackedId] = useState(initialTrackedId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <Link className="btn block" href={`/${locale}/sign-in?next=${encodeURIComponent(nextPath)}`}>
        <Icon name="list" /> {labels.signIn}
      </Link>
    );
  }
  if (trackedId) {
    return (
      <Link className="btn secondary block" href={`/${locale}/app/tracker/${trackedId}`}>
        <Icon name="check" /> {labels.tracking}
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        className="btn block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const out = await callApi<{ id: string }>('POST', '/api/v1/me/applications', {
            opportunity_id: opportunityId,
          });
          setBusy(false);
          if (out.ok && out.data) setTrackedId(out.data.id);
          else setError(errorMessage(errors, out));
        }}
      >
        <Icon name="list" /> {labels.track}
      </button>
      {error ? (
        <p className="field-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      ) : null}
    </>
  );
}
