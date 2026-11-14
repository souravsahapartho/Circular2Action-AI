import Link from 'next/link';
import { type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';
import { type Reason } from '@/lib/reasons';
import { OpportunityList } from './opportunity-list';
import { Icon } from './ui';
import { WebJobCard, type WebJob } from './web-job-card';

export type RecommendedOpp = OpportunitySummary & { score: number; reasons: Reason[] };
export type RecommendedWeb = WebJob & { score: number; reasons: Reason[] };

export interface Recs {
  opportunities: RecommendedOpp[];
  web_jobs: RecommendedWeb[];
  personalised: boolean;
  top_categories?: string[];
}

/** Fetches this person's suggestions once so a page can use them in more than one place. */
export async function loadRecommendations(locale: Locale, limit: number): Promise<Recs | null> {
  const res = await apiGet<Recs>(`/api/v1/me/recommendations?locale=${locale}&limit=${limit}`, {
    auth: true,
    timeoutMs: 12_000,
  });
  return res.kind === 'ok' ? res.data : null;
}

/** "Recommended for you": ranked opportunities with the reason chips, and web jobs that match the interests. */
export async function ForYou({
  locale,
  d,
  savedIds,
  nextPath,
  limit = 6,
  showWeb = true,
  categoryNames,
  initial,
}: {
  locale: Locale;
  d: Dictionary;
  savedIds: Set<string>;
  nextPath: string;
  limit?: number;
  showWeb?: boolean;
  categoryNames: Record<string, string>;
  /** suggestions the page already loaded */
  initial?: Recs | null;
}) {
  const data = initial === undefined ? await loadRecommendations(locale, limit) : initial;
  const now = new Date();
  return (
    <section className="section" aria-labelledby="foryou-h">
      <div className="section-head">
        <div>
          <h2 id="foryou-h">{d.forYou.title}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {data?.personalised ? d.forYou.intro : d.forYou.introNew}
          </p>
        </div>
        <Link href={`/${locale}/app/interests`}>
          {data?.personalised ? d.forYou.editInterests : d.forYou.setInterests}{' '}
          <Icon name="arrow" size="sm" />
        </Link>
      </div>
      {data && data.opportunities.length > 0 ? (
        <OpportunityList
          items={data.opportunities}
          locale={locale}
          dict={d}
          now={now}
          savedIds={savedIds}
          nextPath={nextPath}
          reasons={Object.fromEntries(data.opportunities.map((o) => [o.id, o.reasons]))}
          categoryNames={categoryNames}
        />
      ) : (
        <p className="muted">{d.forYou.empty}</p>
      )}
      {showWeb && data && data.web_jobs.length > 0 ? (
        <>
          <h3 style={{ marginTop: 28 }}>{d.forYou.webTitle}</h3>
          <p className="muted small" style={{ marginTop: 0 }}>
            {d.forYou.webText}
          </p>
          <div className="grid-2">
            {data.web_jobs.slice(0, 4).map((j) => (
              <WebJobCard
                key={j.id}
                job={j}
                locale={locale}
                d={d}
                tracked
                reasons={j.reasons}
                categoryNames={categoryNames}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
