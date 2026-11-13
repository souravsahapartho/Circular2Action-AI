import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { Breadcrumbs, EmptyState, ErrorState } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { apiGet, safeHref } from '@/lib/api';
import { requireUser } from '@/lib/session';
import { ApplicationEditor, type AppDetail } from './application-editor';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false } };

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const me = await requireUser(locale, `/${locale}/app/tracker/${id}`);
  const res = /^\d{1,20}$/.test(id)
    ? await apiGet<AppDetail>(`/api/v1/me/applications/${id}`, { auth: true })
    : ({ kind: 'not_found' } as const);
  return (
    <Page locale={locale} dict={d} section="tracker" path={`/app/tracker/${id}`} me={me}>
      {res.kind === 'ok' ? (
        <>
          <Breadcrumbs
            items={[
              { href: `/${locale}/app/tracker`, label: d.app.trackerTitle },
              { label: res.data.title },
            ]}
          />
          <h1>{res.data.title}</h1>
          <p className="muted">
            {res.data.organization}
            {res.data.opportunity_id ? (
              <>
                {' · '}
                <Link href={`/${locale}/opportunities/x-${res.data.opportunity_id}`}>
                  {d.nav.explore}
                </Link>
              </>
            ) : null}
            {safeHref(res.data.url) ? (
              <>
                {' · '}
                <a href={safeHref(res.data.url)!} rel="noopener nofollow" target="_blank">
                  {d.detail.official}
                </a>
              </>
            ) : null}
          </p>
          <ApplicationEditor
            initial={res.data}
            locale={locale}
            labels={d.tracker}
            errors={d.errors}
            explore={d.explore}
          />
        </>
      ) : res.kind === 'not_found' ? (
        <EmptyState
          title={d.detail.notFound}
          action={
            <Link className="btn" href={`/${locale}/app/tracker`}>
              {d.app.trackerTitle}
            </Link>
          }
        />
      ) : (
        <ErrorState dict={d} />
      )}
    </Page>
  );
}
