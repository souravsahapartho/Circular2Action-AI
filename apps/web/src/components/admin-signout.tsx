'use client';

import { callApi } from '@/lib/client-api';
import { Icon } from './ui';

export function AdminSignOut({ to = '/admin/login' }: { to?: string }) {
  return (
    <button
      type="button"
      className="btn secondary sm"
      onClick={async () => {
        await callApi('POST', '/api/v1/auth/logout');
        window.location.assign(to);
      }}
    >
      <Icon name="logout" size="sm" /> Sign out
    </button>
  );
}
