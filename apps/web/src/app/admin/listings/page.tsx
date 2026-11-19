import { AdminShell } from '@/components/admin-shell';
import { Alert } from '@/components/ui';
import { apiGet } from '@/lib/api';
import { requireStaff } from '@/lib/session';
import { ListingsPanel, type ListingRow, type SourceInfo } from './listings-panel';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Web listings' };

const PAGE = 25;

export default async function AdminListings({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; source?: string; page?: string }>;
}) {
  const me = await requireStaff();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 120);
  const source = /^[a-z]{3,20}$/.test(sp.source ?? '') ? sp.source : undefined;
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String((page - 1) * PAGE) });
  if (q) qs.set('q', q);
  if (source) qs.set('source', source);
  const res = await apiGet<ListingRow[]>(`/api/v1/admin/listings?${qs}`, { auth: true });
  const sources = (res.kind === 'ok' ? res.meta?.sources : undefined) as SourceInfo[] | undefined;
  const total = res.kind === 'ok' ? (res.total ?? res.data.length) : 0;
  return (
    <AdminShell me={me} active="listings" title="Web listings">
      {res.kind !== 'ok' ? (
        <Alert kind="error">Could not load the web listings. Reload in a moment.</Alert>
      ) : (
        <ListingsPanel
          initialSources={sources ?? []}
          rows={res.data}
          total={total}
          page={page}
          pageSize={PAGE}
          q={q}
          source={source}
        />
      )}
    </AdminShell>
  );
}
