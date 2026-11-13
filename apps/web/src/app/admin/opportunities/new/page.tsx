import { AdminShell } from '@/components/admin-shell';
import { apiGet, type CategoryInfo, type LocationInfo } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { OpportunityForm } from '../opportunity-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New opportunity' };

export default async function NewOpportunity() {
  const me = await requireStaff();
  const [cats, locs, orgs] = await Promise.all([
    apiGet<CategoryInfo[]>('/api/v1/categories?locale=en'),
    apiGet<LocationInfo[]>('/api/v1/locations?locale=en'),
    apiGet<Array<{ id: string; name_en: string | null; name_bn: string | null }>>(
      '/api/v1/admin/organizations',
      { auth: true },
    ),
  ]);
  return (
    <AdminShell me={me} active="opportunities" title="New opportunity">
      <OpportunityForm
        mode="create"
        categories={cats.kind === 'ok' ? cats.data : []}
        locations={locs.kind === 'ok' ? locs.data : []}
        organizations={
          orgs.kind === 'ok'
            ? orgs.data.map((o) => ({ id: o.id, name: o.name_en ?? o.name_bn ?? o.id }))
            : []
        }
        canPublish={me.roles.some((r) => ['verifier', 'admin', 'super_admin'].includes(r))}
      />
    </AdminShell>
  );
}
