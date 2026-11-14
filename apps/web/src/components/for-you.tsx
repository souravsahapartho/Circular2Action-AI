import Link from 'next/link';
import { type Locale } from '@/i18n/config';
import { t, type Dictionary } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';
import { titleFor } from '@/lib/titles';
import { SaveButton } from './save-button';
import { Badge, DeadlineChip, Icon } from './ui';
import { WebJobCard, type WebJob } from './web-job-card';

export interface Reason {
  code: string;
  value?: string;
}
export type RecommendedOpp = OpportunitySummary & { score: number; reasons: Reason[] };
export type RecommendedWeb = WebJob & { score: number; reasons: Reason[] };

interface Recs {
  opportunities: RecommendedOpp[];
  web_jobs: RecommendedWeb[];
  personalised: boolean;
}

export function reasonText(d: Dictionary, r: Reason, names: Record<string, string>): string | null {
  const text = (d.forYou as Record<string, string>)[`r_${r.code}`];
  if (!text) return null;
  const value = r.code.startsWith('category')
    ? (names[r.value ?? ''] ?? r.value ?? '')
    : (r.value ?? '');
  return t(text, { value });
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
}: {
  locale: Locale;
  d: Dictionary;
  savedIds: Set<string>;
  nextPath: string;
  limit?: number;
  showWeb?: boolean;
  categoryNames: Record<string, string>;
}) {
  const res = await apiGet<Recs>(`/api/v1/me/recommendations?locale=${locale}&limit=${limit}`, {
    auth: true,
    timeoutMs: 12_000,
  });
  const now = new Date();
  const data = res.kind === 'ok' ? res.data : null;
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
        <ul className="opp-list">
          {data.opportunities.map((o) => (
            <li key={o.id} className="opp">
              <div>
                <h3>
                  <Link href={`/${locale}/opportunities/${o.slug}-${o.id}`}>{o.title}</Link>
                </h3>
                <div className="meta">
                  <span>
                    <Icon name="building" size="sm" />
                    {o.organization}
                  </span>
                  {o.location ? (
                    <span>
                      <Icon name="pin" size="sm" />
                      {o.location}
                    </span>
                  ) : null}
                  {o.category ? <Badge tone="neutral">{o.category}</Badge> : null}
                </div>
                {o.reasons.length > 0 ? (
                  <div className="reasons" aria-label={d.forYou.why}>
                    {o.reasons
                      .map((r) => reasonText(d, r, categoryNames))
                      .filter((x): x is string => x !== null)
                      .map((x) => (
                        <span key={x} className="reason">
                          <Icon name="check" size="sm" /> {x}
                        </span>
                      ))}
                  </div>
                ) : null}
              </div>
              <div className="side">
                {o.deadline_at ? (
                  <DeadlineChip iso={o.deadline_at} locale={locale} dict={d} now={now} />
                ) : null}
                <SaveButton
                  opportunityId={o.id}
                  initialSaved={savedIds.has(o.id)}
                  signedIn
                  locale={locale}
                  nextPath={nextPath}
                  labels={{
                    save: d.detail.save,
                    saved: d.detail.saved,
                    signIn: d.detail.signInToSave,
                  }}
                  variant="icon"
                />
              </div>
            </li>
          ))}
        </ul>
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
              <WebJobCard key={j.id} job={j} locale={locale} d={d} tracked />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

export { titleFor };
