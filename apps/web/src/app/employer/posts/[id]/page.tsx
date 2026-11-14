import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui';
import { EmployerShell } from '@/components/employer-shell';
import { apiGet, type CategoryInfo, type LocationInfo } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { OpportunityForm, type AdminOpp } from '../../../admin/opportunities/opportunity-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit post' };

export default async function EditPost({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  const me = await requireEmployer();
  const [opp, cats, locs, prof] = await Promise.all([
    apiGet<AdminOpp>(`/api/v1/employer/opportunities/${id}`, { auth: true }),
    apiGet<CategoryInfo[]>('/api/v1/categories?locale=en'),
    apiGet<LocationInfo[]>('/api/v1/locations?locale=en'),
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
  ]);
  if (opp.kind === 'not_found') notFound();
  const locked =
    opp.kind === 'ok' && ['published', 'in_review'].includes(opp.data.publication_status);
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="posts"
      title="Edit post"
    >
      {opp.kind === 'ok' ? (
        <>
          {locked ? (
            <Alert kind="info" role="note">
              {opp.data.publication_status === 'published'
                ? 'This post is live. Close it to edit it, then send it for review again.'
                : 'This post is waiting for staff review. Withdraw it from review to edit it.'}
            </Alert>
          ) : null}
          <OpportunityForm
            portal="employer"
            mode="edit"
            initial={opp.data}
            categories={cats.kind === 'ok' ? cats.data : []}
            locations={locs.kind === 'ok' ? locs.data : []}
            organizations={[]}
            canPublish={false}
          />
        </>
      ) : (
        <Alert kind="error">Could not load this post. Reload in a moment.</Alert>
      )}
    </EmployerShell>
  );
}
