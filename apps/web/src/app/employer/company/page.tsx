import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { CompanyForm, type Company } from './company-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Company' };

export default async function CompanyPage() {
  const me = await requireEmployer();
  const prof = await apiGet<Company>('/api/v1/employer/profile', { auth: true });
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="company"
      title="Company"
    >
      {prof.kind === 'ok' ? (
        <div className="panel-grid two-equal">
          <section className="panel">
            <h2>Company details</h2>
            <CompanyForm initial={prof.data} />
          </section>
          <section className="panel">
            <h2>Verification</h2>
            <p>
              Status:{' '}
              <strong>
                {prof.data.verification_status === 'verified' ? 'Verified' : 'Not verified yet'}
              </strong>
            </p>
            <p className="muted">
              Staff verify companies after checking the website and contact details. Posts from a
              verified company are trusted faster. Keep your website and phone up to date.
            </p>
          </section>
        </div>
      ) : (
        <Alert kind="error">Could not load your company. Reload in a moment.</Alert>
      )}
    </EmployerShell>
  );
}
