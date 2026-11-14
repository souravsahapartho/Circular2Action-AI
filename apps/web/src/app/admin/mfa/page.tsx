import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { MfaPanel } from './mfa-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Two-factor authentication' };

export default async function Mfa() {
  const me = await getMe();
  if (!me) redirect('/admin/login');
  if (!me.staff) redirect('/admin/login');
  if (me.mfa_verified) redirect('/admin');
  return (
    <main id="main" className="container" style={{ padding: '40px 16px', maxWidth: 560 }}>
      <div className="card">
        <h1 style={{ fontSize: '1.5rem' }}>Two-factor authentication</h1>
        <p className="muted">
          Staff accounts need a second step.{' '}
          {me.mfa_enrolled
            ? 'Enter the 6-digit code from your authenticator app.'
            : 'Set up an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) to continue.'}
        </p>
        <MfaPanel enrolled={me.mfa_enrolled} email={me.email} />
      </div>
    </main>
  );
}
