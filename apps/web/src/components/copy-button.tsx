'use client';

import { useState } from 'react';

/** Copies a value (such as a tracking ID) and says so for a moment. */
export function CopyButton({
  value,
  label,
  doneLabel,
}: {
  value: string;
  label: string;
  doneLabel: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn secondary sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked: the ID is still on screen */
        }
      }}
    >
      {done ? doneLabel : label}
    </button>
  );
}
