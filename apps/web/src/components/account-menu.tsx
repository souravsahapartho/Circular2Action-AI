'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { callApi } from '@/lib/client-api';
import { Icon } from './ui';

export interface MenuLabels {
  dashboard: string;
  profile: string;
  saved: string;
  tracker: string;
  applications: string;
  interests: string;
  notifications: string;
  settings: string;
  signOut: string;
  signIn: string;
  register: string;
  account: string;
}

export async function signOut(locale: string) {
  await callApi('POST', '/api/v1/auth/logout');
  window.location.assign(`/${locale}`);
}

export function AccountMenu({
  locale,
  name,
  staff,
  labels,
}: {
  locale: string;
  name: string;
  staff: boolean;
  labels: MenuLabels;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute('open');
  return (
    <details className="menu" ref={ref}>
      <summary aria-label={labels.account}>
        <span className="avatar" aria-hidden="true">
          {[...name.trim()][0]?.toUpperCase() ?? 'U'}
        </span>
      </summary>
      <div className="menu-panel" role="menu">
        <p className="small muted" style={{ padding: '4px 12px 8px', margin: 0 }}>
          {name}
        </p>
        <Link href={`/${locale}/app`} onClick={close}>
          <Icon name="dashboard" /> {labels.dashboard}
        </Link>
        <Link href={`/${locale}/app/profile`} onClick={close}>
          <Icon name="user" /> {labels.profile}
        </Link>
        <Link href={`/${locale}/app/saved`} onClick={close}>
          <Icon name="bookmark" /> {labels.saved}
        </Link>
        <Link href={`/${locale}/app/applications`} onClick={close}>
          <Icon name="file" /> {labels.applications}
        </Link>
        <Link href={`/${locale}/app/tracker`} onClick={close}>
          <Icon name="list" /> {labels.tracker}
        </Link>
        <Link href={`/${locale}/app/interests`} onClick={close}>
          <Icon name="sliders" /> {labels.interests}
        </Link>
        <Link href={`/${locale}/app/notifications`} onClick={close}>
          <Icon name="info" /> {labels.notifications}
        </Link>
        <Link href={`/${locale}/app/settings`} onClick={close}>
          <Icon name="settings" /> {labels.settings}
        </Link>
        {staff ? (
          <Link href="/admin" onClick={close}>
            <Icon name="shield" /> Admin
          </Link>
        ) : null}
        <hr />
        <button type="button" onClick={() => void signOut(locale)}>
          <Icon name="logout" /> {labels.signOut}
        </button>
      </div>
    </details>
  );
}
