'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { callApi } from '@/lib/client-api';

/** Publish or unpublish from the list. The API still checks permission and the official-link rule. */
export function QuickPublish({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const action = status === 'published' ? 'unpublish' : status === 'removed' ? null : 'publish';
  if (!action) return null;
  return (
    <span>
      <button
        type="button"
        className={`btn sm ${action === 'publish' ? '' : 'secondary'}`}
        disabled={busy}
        onClick={async () => {
          if (
            action === 'unpublish' &&
            !window.confirm('Unpublish this opportunity? It disappears from the site.')
          ) {
            return;
          }
          setBusy(true);
          setErr(null);
          const out = await callApi('POST', `/api/v1/admin/opportunities/${id}/${action}`, {});
          setBusy(false);
          if (out.ok) router.refresh();
          else setErr(out.error?.details?.[0]?.message ?? out.error?.message ?? 'Not allowed.');
        }}
      >
        {busy ? '…' : action === 'publish' ? 'Publish' : 'Unpublish'}
      </button>
      {err ? (
        <span className="field-error" role="alert" style={{ display: 'block' }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
