'use client';

import { callApi } from '@/lib/client-api';
import { Icon } from './ui';

export function AdminSignOut() {
  return (
    <button
      type="button"
      className="btn secondary sm"
      onClick={async () => {
        await callApi('POST', '/api/v1/auth/logout');
        window.location.assign('/en/sign-in');
      }}
    >
      <Icon name="logout" size="sm" /> Sign out
    </button>
  );
}
