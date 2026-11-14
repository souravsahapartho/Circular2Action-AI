import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { ApplicationPanel } from '../../../admin/applications/[id]/application-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Application' };

interface Detail {
  id: string;
  tracking_code: string;
  status: string;
  submitted_at: string;
  updated_at: string;
  applicant_name: string;
  applicant_email: string;
  applicant_phone: string | null;
  cover_note: string | null;
  eligibility_status: string | null;
  profile_snapshot: {
    date_of_birth?: string | null;
    gender?: string | null;
    headline?: string | null;
    education?: Array<{
      level: string;
      status: string;
      institution?: string | null;
      discipline?: string | null;
      passing_year?: number | null;
      result_scale?: string | null;
      result_value?: number | null;
    }>;
    eligibility?: { status: string; summary?: { pass: number; fail: number; unknown: number } };
  } | null;
  admin_note: string | null;
  opportunity: { id: string; slug: string; title: string; organization: string };
  timeline: Array<{
    id: string;
    to_status: string;
    note: string | null;
    at: string;
    by_staff?: boolean;
    public?: boolean;
  }>;
}

const ELIG: Record<string, string> = {
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  needs_verification: 'Needs verification',
  insufficient_information: 'Insufficient information',
};
const LEVEL: Record<string, string> = {
  ssc: 'SSC',
  hsc: 'HSC',
  diploma: 'Diploma',
  bachelor: 'Bachelor',
  masters: 'Masters',
  mphil: 'MPhil',
  phd: 'PhD',
};
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

export default async function EmployerApplication({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireEmployer();
  if (!/^\d{1,20}$/.test(id)) notFound();
  const [res, prof] = await Promise.all([
    apiGet<Detail>(`/api/v1/employer/applications/${id}`, { auth: true }),
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
  ]);
  if (res.kind === 'not_found') notFound();
  const a = res.kind === 'ok' ? res.data : null;
  const snap = a?.profile_snapshot ?? null;
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="applications"
      title={a ? `Application ${a.tracking_code}` : 'Application'}
      actions={
        <Link className="btn secondary" href="/employer/applications">
          ← All applications
        </Link>
      }
    >
      {!a ? (
        <Alert kind="error">Could not load this application. Reload in a moment.</Alert>
      ) : (
        <div className="panel-grid two">
          <div className="stack">
            <section className="panel">
              <h2>Applicant</h2>
              <dl className="kv">
                <dt>Name</dt>
                <dd>{a.applicant_name}</dd>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${a.applicant_email}`}>{a.applicant_email}</a>
                </dd>
                <dt>Phone</dt>
                <dd>{a.applicant_phone ?? '–'}</dd>
                <dt>Submitted</dt>
                <dd>{fmt(a.submitted_at)}</dd>
              </dl>
            </section>
            <section className="panel">
              <h2>Post</h2>
              <p style={{ margin: 0 }}>
                <strong>{a.opportunity.title}</strong>
              </p>
              <p style={{ margin: '8px 0 0' }}>
                <Link href={`/employer/posts/${a.opportunity.id}`}>Open the post</Link>
              </p>
            </section>
            <section className="panel">
              <h2>Profile shared with you</h2>
              <dl className="kv">
                <dt>Eligibility</dt>
                <dd>
                  {a.eligibility_status
                    ? (ELIG[a.eligibility_status] ?? a.eligibility_status)
                    : '–'}
                  {snap?.eligibility?.summary
                    ? ` (${snap.eligibility.summary.pass} met, ${snap.eligibility.summary.fail} not met, ${snap.eligibility.summary.unknown} unclear)`
                    : ''}
                </dd>
                <dt>Date of birth</dt>
                <dd>{snap?.date_of_birth ?? '–'}</dd>
                <dt>Headline</dt>
                <dd>{snap?.headline ?? '–'}</dd>
              </dl>
              {snap?.education && snap.education.length > 0 ? (
                <div className="table-wrap" style={{ marginTop: 12 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Level</th>
                        <th>Status</th>
                        <th>Institution</th>
                        <th>Subject</th>
                        <th>Year</th>
                        <th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {snap.education.map((e, i) => (
                        <tr key={i}>
                          <td>{LEVEL[e.level] ?? e.level}</td>
                          <td>{e.status}</td>
                          <td>{e.institution ?? '–'}</td>
                          <td>{e.discipline ?? '–'}</td>
                          <td>{e.passing_year ?? '–'}</td>
                          <td>
                            {e.result_value !== null && e.result_value !== undefined
                              ? `${e.result_value}${e.result_scale ? ` (${e.result_scale})` : ''}`
                              : '–'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
            {a.cover_note ? (
              <section className="panel">
                <h2>Note from the applicant</h2>
                <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{a.cover_note}</p>
              </section>
            ) : null}
          </div>
          <ApplicationPanel
            id={a.id}
            status={a.status}
            adminNote={a.admin_note}
            canManage
            timeline={a.timeline}
            apiBase="/api/v1/employer/applications"
          />
        </div>
      )}
    </EmployerShell>
  );
}
