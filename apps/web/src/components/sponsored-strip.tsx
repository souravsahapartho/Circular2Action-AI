import { type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { apiGet, type OpportunitySummary } from '@/lib/api';
import { reasonText, type Reason } from '@/lib/reasons';
import { SponsoredLink } from './sponsored-link';
import { Badge, DeadlineChip, Icon } from './ui';

type Sponsored = OpportunitySummary & { sponsored: true; reasons: Reason[] };

const TEXT = {
  en: { label: 'Sponsored', title: 'Hiring now', why: 'Why you see this', view: 'View' },
  bn: { label: 'স্পনসর্ড', title: 'এখনই নিয়োগ', why: 'কেন দেখছেন', view: 'দেখুন' },
};

/**
 * Sponsored posts (demo plan). Always labelled. For a signed-in person they are the ones that fit their interests,
 * rotated among the best few; for a visitor they rotate at random. Renders nothing when there are none.
 */
export async function SponsoredStrip({
  locale,
  d,
  signedIn,
  categoryNames = {},
  limit = 2,
}: {
  locale: Locale;
  d: Dictionary;
  signedIn: boolean;
  categoryNames?: Record<string, string>;
  limit?: number;
}) {
  const url = signedIn
    ? `/api/v1/me/sponsored?locale=${locale}&limit=${limit}`
    : `/api/v1/sponsored?locale=${locale}&limit=${limit}`;
  const res = await apiGet<Sponsored[]>(url, { auth: signedIn, timeoutMs: 6000 });
  if (res.kind !== 'ok' || res.data.length === 0) return null;
  const t = TEXT[locale];
  const now = new Date();
  return (
    <section className="sponsored" aria-label={t.title}>
      <div className="sponsored-head">
        <h2>
          <Icon name="star" size="sm" /> {t.title}
        </h2>
        <Badge tone="warn">{t.label}</Badge>
      </div>
      <ul className="sponsored-list">
        {res.data.map((o) => {
          const chips = (o.reasons ?? [])
            .map((r) => reasonText(d, r, categoryNames, locale))
            .filter((x): x is string => x !== null)
            .slice(0, 3);
          return (
            <li key={o.id} className="sponsored-card" data-cat={o.category_slug ?? undefined}>
              <div className="row-flex" style={{ justifyContent: 'space-between' }}>
                <span className="sponsored-tag">{t.label}</span>
                {o.deadline_at ? (
                  <DeadlineChip iso={o.deadline_at} locale={locale} dict={d} now={now} />
                ) : null}
              </div>
              <h3>
                <SponsoredLink id={o.id} href={`/${locale}/opportunities/${o.slug}-${o.id}`}>
                  {o.title}
                </SponsoredLink>
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
              </div>
              {chips.length > 0 ? (
                <div className="reasons" aria-label={t.why}>
                  {chips.map((x) => (
                    <span key={x} className="reason">
                      <Icon name="check" size="sm" /> {x}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
