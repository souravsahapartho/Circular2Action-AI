import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Icon, Logo } from '@/components/ui';
import { getMe } from '@/lib/session';
import { EmployerLogin } from './employer-login';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

/** The employer portal's own sign-in. */
export default async function EmployerLoginPage() {
  const me = await getMe();
  if (me?.employer) redirect('/employer');
  return (
    <main id="main" className="portal-login">
      <section className="portal-login-art" aria-hidden="true">
        <Logo locale="en" />
        <div>
          <h1>Hire with Circular2Action</h1>
          <p style={{ color: 'var(--brand-100)', maxWidth: '44ch' }}>
            Post jobs, internships and circulars, receive applications with tracking IDs and move
            each one forward from one dashboard.
          </p>
          <ul>
            <li>
              <Icon name="briefcase" /> Post and manage your own opportunities
            </li>
            <li>
              <Icon name="file" /> Review applicants and update their status
            </li>
            <li>
              <Icon name="shield" /> Staff check every post before it goes live
            </li>
          </ul>
        </div>
        <p className="small" style={{ color: 'var(--brand-300)', margin: 0 }}>
          Circular2Action · employers
        </p>
      </section>
      <section className="portal-login-form">
        <div className="card stack">
          <div>
            <span className="badge info">Employers</span>
            <h1 style={{ fontSize: '1.5rem', margin: '10px 0 4px' }}>Sign in to your dashboard</h1>
            <p className="muted" style={{ margin: 0 }}>
              Use the account you created as an employer.
            </p>
          </div>
          <EmployerLogin />
          <p className="small muted" style={{ margin: 0 }}>
            New here? <Link href="/en/register?type=employer">Create an employer account</Link>
            <br />
            Looking for a job? <Link href="/en">Go to Circular2Action</Link>
          </p>
        </div>
      </section>
    </main>
  );
}
