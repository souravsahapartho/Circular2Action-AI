import { EmployerShell } from '@/components/employer-shell';
import { apiGet, type CategoryInfo, type LocationInfo } from '@/lib/api';
import { requireEmployer } from '@/lib/session';
import { OpportunityForm } from '../../../admin/opportunities/opportunity-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New post' };

export default async function NewPost() {
  const me = await requireEmployer();
  const [cats, locs, prof] = await Promise.all([
    apiGet<CategoryInfo[]>('/api/v1/categories?locale=en'),
    apiGet<LocationInfo[]>('/api/v1/locations?locale=en'),
    apiGet<{ company_name: string }>('/api/v1/employer/profile', { auth: true }),
  ]);
  return (
    <EmployerShell
      me={me}
      company={prof.kind === 'ok' ? prof.data.company_name : ''}
      active="posts"
      title="New post"
    >
      <p className="muted" style={{ maxWidth: '70ch' }}>
        Describe the opportunity, then save it as a draft. When it is ready, send it for review:
        staff check it and publish it.
      </p>
      <OpportunityForm
        portal="employer"
        mode="create"
        categories={cats.kind === 'ok' ? cats.data : []}
        locations={locs.kind === 'ok' ? locs.data : []}
        organizations={[]}
        canPublish={false}
      />
    </EmployerShell>
  );
}
