import 'server-only';
import { redirect } from 'next/navigation';
import type { Locale } from '@/i18n/config';
import { apiGet, hasSession } from './api';

export interface Me {
  id: string;
  email: string;
  display_name: string;
  locale: 'bn' | 'en';
  status: 'active' | 'suspended' | 'pending_deletion';
  email_verified: boolean;
  roles: string[];
  staff: boolean;
  employer: boolean;
  mfa_verified: boolean;
  mfa_enrolled: boolean;
}

/** The signed-in user, or null. Skips the API call entirely when there is no session cookie. */
export async function getMe(): Promise<Me | null> {
  if (!(await hasSession())) return null;
  const res = await apiGet<Me>('/api/v1/me', { auth: true });
  return res.kind === 'ok' ? res.data : null;
}

/** For signed-in pages: sends visitors without a session to sign in and back (`next` stays on this site). */
export async function requireUser(locale: Locale, nextPath: string): Promise<Me> {
  const me = await getMe();
  if (!me) redirect(`/${locale}/sign-in?next=${encodeURIComponent(nextPath)}`);
  if (me.staff && !me.mfa_verified) redirect('/admin/mfa');
  // an account waiting for deletion can only see the settings page (restricted scope, DEL-02)
  if (me.status === 'pending_deletion' && !nextPath.endsWith('/app/settings'))
    redirect(`/${locale}/app/settings`);
  return me;
}

/** For /admin: staff only, with the second factor verified. */
export async function requireStaff(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/admin/login');
  if (!me.staff) redirect('/admin/login');
  if (!me.mfa_verified) redirect('/admin/mfa');
  return me;
}

/** For /employer: an account that signed up as an employer (not staff, no second factor). */
export async function requireEmployer(): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/employer/login');
  if (!me.employer) redirect('/employer/login');
  return me;
}
