'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { callApi } from '@/lib/client-api';

const PATH = 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0';

/** Bell with the unread count. Asking for the count also lets the API prepare any alerts that are due. */
export function NotificationBell({
  locale,
  label,
  unreadLabel,
}: {
  locale: string;
  label: string;
  /** contains {n} */
  unreadLabel: string;
}) {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const out = await callApi<{ unread: number }>('GET', '/api/v1/me/notifications/unread-count');
      if (alive && out.ok && out.data) setUnread(out.data.unread);
    };
    void load();
    const timer = setInterval(() => void load(), 120_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const n = unread ?? 0;
  return (
    <Link
      href={`/${locale}/app/notifications`}
      className="bell"
      aria-label={n > 0 ? `${label}, ${unreadLabel.replace('{n}', String(n))}` : label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={PATH} />
      </svg>
      {n > 0 ? <span className="bell-count">{n > 9 ? '9+' : n}</span> : null}
    </Link>
  );
}
