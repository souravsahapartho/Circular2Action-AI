import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { Alert, Breadcrumbs, EmptyState, ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, idFromSlug, type OpportunityDetail } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { ApplyForm } from './apply-form';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Apply({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/opportunities/${slug}/apply`);
  const id = idFromSlug(slug);
  const res = id
    ? await apiGet<OpportunityDetail>(`/api/v1/opportunities/${id}?locale=${locale}`)
    : ({ kind: 'not_found' } as const);
  const mine = await apiGet<
    Array<{ id: string; tracking_code: string; opportunity: { id: string } }>
  >('/api/v1/me/site-applications', { auth: true });
  const existing =
    mine.kind === 'ok' && id ? (mine.data.find((a) => a.opportunity.id === id) ?? null) : null;
  const closed =
    res.kind === 'ok' && res.data.deadline_at
      ? new Date(res.data.deadline_at) <= new Date()
      : false;
  const accepts =
    res.kind === 'ok' && (res.data.apply_mode === 'site' || res.data.apply_mode === 'both');

  return (
    <Page locale={locale} dict={d} section="explore" path={`/opportunities/${slug}/apply`} me={me}>
      {res.kind === 'ok' ? (
        <>
          <Breadcrumbs
            items={[
              { href: `/${locale}/opportunities`, label: d.nav.explore },
              { href: `/${locale}/opportunities/${slug}`, label: res.data.title },
              { label: d.apply.title },
            ]}
          />
          <div className="narrow">
            <h1>{d.apply.title}</h1>
            <p className="muted">
              <Link href={`/${locale}/opportunities/${slug}`}>{res.data.title}</Link> ·{' '}
              {res.data.organization}
            </p>
            {!accepts ? (
              <Alert kind="warn">{d.apply.notAccepted}</Alert>
            ) : closed && !existing ? (
              <Alert kind="warn">{d.apply.closed}</Alert>
            ) : (
              <ApplyForm
                opportunityId={res.data.id}
                locale={locale}
                name={me.display_name}
                email={me.email}
                existing={existing ? { id: existing.id, code: existing.tracking_code } : null}
                labels={d.apply}
                errors={d.errors}
              />
            )}
          </div>
        </>
      ) : res.kind === 'not_found' ? (
        <EmptyState title={d.detail.notFound} text={d.explore.emptyText} />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
