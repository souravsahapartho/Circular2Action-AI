import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { OpportunityList } from '@/components/opportunity-list';
import { EmptyState, ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function Saved({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/saved`);
  const res = await apiGet<OpportunitySummary[]>(`/api/v1/me/saved?locale=${locale}`, {
    auth: true,
  });
  return (
    <Page locale={locale} dict={d} section="saved" path="/app/saved" me={me}>
      <h1>{d.app.savedTitle}</h1>
      {res.kind === 'ok' && res.data.length > 0 ? (
        <OpportunityList
          items={res.data}
          locale={locale}
          dict={d}
          now={new Date()}
          savedIds={new Set(res.data.map((o) => o.id))}
          nextPath={`/${locale}/app/saved`}
        />
      ) : res.kind === 'ok' ? (
        <EmptyState
          icon="bookmark"
          title={d.saved.empty}
          text={d.saved.emptyText}
          action={
            <Link className="btn" href={`/${locale}/opportunities`}>
              {d.app.browse}
            </Link>
          }
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
