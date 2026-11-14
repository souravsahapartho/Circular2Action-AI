import { redirect } from 'next/navigation';
import { Icon, Logo } from '@/components/ui';
import { getMe } from '@/lib/session';
import { StaffLogin } from './staff-login';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

/** The staff portal's own sign-in: separate from the public site, with the second factor next. */
export default async function PortalLogin() {
  const me = await getMe();
  if (me?.staff) redirect(me.mfa_verified ? '/admin' : '/admin/mfa');
  return (
    <main id="main" className="portal-login">
      <section className="portal-login-art" aria-hidden="true">
        <Logo locale="en" />
        <div>
          <h1>Staff portal</h1>
          <p style={{ color: 'var(--brand-100)', maxWidth: '44ch' }}>
            Publish opportunities, handle applications and keep the web jobs feed in order. Every
            change is recorded.
          </p>
          <ul>
            <li>
              <Icon name="briefcase" /> Opportunities and verification
            </li>
            <li>
              <Icon name="file" /> Applications and tracking IDs
            </li>
            <li>
              <Icon name="globe" /> Jobs from the web
            </li>
            <li>
              <Icon name="shield" /> Two-factor sign-in and audit log
            </li>
          </ul>
        </div>
        <p className="small" style={{ color: 'var(--brand-300)', margin: 0 }}>
          Circular2Action · staff only
        </p>
      </section>
      <section className="portal-login-form">
        <div className="card stack">
          <div>
            <span className="badge warn">Staff only</span>
            <h1 style={{ fontSize: '1.5rem', margin: '10px 0 4px' }}>Sign in to the portal</h1>
            <p className="muted" style={{ margin: 0 }}>
              Use your staff account. A second step (authenticator code) follows.
            </p>
          </div>
          <StaffLogin />
          <p className="small muted" style={{ margin: 0 }}>
            Looking for the public site? <a href="/en">Go to Circular2Action</a>
          </p>
        </div>
      </section>
    </main>
  );
}
