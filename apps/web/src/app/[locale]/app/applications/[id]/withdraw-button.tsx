'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi, errorMessage } from '@/lib/client-api';

export function WithdrawButton({
  id,
  labels,
  errors,
}: {
  id: string;
  labels: { withdraw: string; confirm: string };
  errors: Record<string, string>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <button
        type="button"
        className="btn danger block"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm(labels.confirm)) return;
          setBusy(true);
          setError(null);
          const out = await callApi('POST', `/api/v1/me/site-applications/${id}/withdraw`);
          setBusy(false);
          if (out.ok) router.refresh();
          else setError(errorMessage(errors, out));
        }}
      >
        {labels.withdraw}
      </button>
    </div>
  );
}
