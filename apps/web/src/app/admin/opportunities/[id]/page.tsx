import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet, type CategoryInfo, type LocationInfo } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { OpportunityForm, type AdminOpp } from '../opportunity-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Edit opportunity' };

export default async function EditOpportunity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  const me = await requireStaff();
  const [opp, cats, locs, orgs] = await Promise.all([
    apiGet<AdminOpp>(`/api/v1/admin/opportunities/${id}`, { auth: true }),
    apiGet<CategoryInfo[]>('/api/v1/categories?locale=en'),
    apiGet<LocationInfo[]>('/api/v1/locations?locale=en'),
    apiGet<Array<{ id: string; name_en: string | null; name_bn: string | null }>>(
      '/api/v1/admin/organizations',
      { auth: true },
    ),
  ]);
  if (opp.kind === 'not_found') notFound();
  const roles = me.roles;
  return (
    <AdminShell me={me} active="opportunities" title="Edit opportunity">
      {opp.kind === 'ok' ? (
        <OpportunityForm
          mode="edit"
          initial={opp.data}
          categories={cats.kind === 'ok' ? cats.data : []}
          locations={locs.kind === 'ok' ? locs.data : []}
          organizations={
            orgs.kind === 'ok'
              ? orgs.data.map((o) => ({ id: o.id, name: o.name_en ?? o.name_bn ?? o.id }))
              : []
          }
          canPublish={roles.some((r) => ['verifier', 'admin', 'super_admin'].includes(r))}
          canRemove={roles.includes('super_admin')}
        />
      ) : (
        <Alert kind="error">Could not load this opportunity. Reload in a moment.</Alert>
      )}
    </AdminShell>
  );
}
