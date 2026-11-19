import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { OpportunitySummary } from '@/lib/api';
import { reasonText, type Reason } from '@/lib/reasons';
import { interleave } from '@/lib/mix';
import { safeHref } from '@/lib/urls';
import { TrackedExternalLink } from './beacons';
import { SaveButton } from './save-button';
import { SOURCE_LABEL, type WebJob } from './web-job-card';
import { Badge, DeadlineChip, Icon } from './ui';

/** Opportunity rows (plan 7.1): title, organisation, key facts, deadline, bookmark; optional "why" chips. */
export function OpportunityList({
  items,
  locale,
  dict,
  now,
  savedIds,
  nextPath,
  reasons,
  categoryNames,
  webJobs,
  webTracked = false,
}: {
  items: OpportunitySummary[];
  locale: Locale;
  dict: Dictionary;
  now: Date;
  /** null when signed out */
  savedIds: Set<string> | null;
  nextPath: string;
  /** reasons per opportunity id, from the personalised list */
  reasons?: Record<string, Reason[]>;
  categoryNames?: Record<string, string>;
  /** jobs found on the web, slipped in after every third of ours (ours always come first) */
  webJobs?: WebJob[];
  /** record clicks on the web jobs as activity (signed-in pages) */
  webTracked?: boolean;
}) {
  const mixed = interleave(items, webJobs ?? [], 3);
  return (
    <ul className="opp-list">
      {mixed.map((entry) => {
        if (entry.kind === 'web') {
          const j = entry.item;
          const href = safeHref(j.url);
          const source = SOURCE_LABEL[j.source] ?? j.source;
          return (
            <li key={`web-${j.id}`} className="opp web" data-cat={j.category_slug ?? undefined}>
              <div>
                <span className="web-tag">
                  <Icon name="globe" size="sm" /> {dict.webJobs.fromWeb} · {source}
                </span>
                <h3>
                  <Link href={`/${locale}/web-jobs/${j.id}`}>{j.title}</Link>
                </h3>
                <div className="meta">
                  {j.company ? (
                    <span>
                      <Icon name="building" size="sm" />
                      {j.company}
                    </span>
                  ) : null}
                  {j.location ? (
                    <span>
                      <Icon name="pin" size="sm" />
                      {j.location}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="side">
                <Link className="btn ghost sm" href={`/${locale}/web-jobs/${j.id}`}>
                  {dict.webJobs.viewDetails}
                </Link>
                {href ? (
                  webTracked ? (
                    <TrackedExternalLink href={href} listingId={j.id} className="btn secondary sm">
                      <Icon name="external" size="sm" /> {dict.webJobs.apply}
                    </TrackedExternalLink>
                  ) : (
                    <a
                      className="btn secondary sm"
                      href={href}
                      rel="noopener nofollow"
                      target="_blank"
                    >
                      <Icon name="external" size="sm" /> {dict.webJobs.apply}
                    </a>
                  )
                ) : null}
              </div>
            </li>
          );
        }
        const o = entry.item;
        const chips = (reasons?.[o.id] ?? [])
          .map((r) => reasonText(dict, r, categoryNames ?? {}, locale))
          .filter((x): x is string => x !== null);
        return (
          <li key={o.id} className="opp" data-cat={o.category_slug ?? undefined}>
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
              {chips.length > 0 ? (
                <div className="reasons" aria-label={dict.forYou.why}>
                  {chips.map((x) => (
                    <span key={x} className="reason">
                      <Icon name="check" size="sm" /> {x}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="side">
              {o.deadline_at ? (
                <DeadlineChip iso={o.deadline_at} locale={locale} dict={dict} now={now} />
              ) : null}
              <SaveButton
                opportunityId={o.id}
                initialSaved={savedIds?.has(o.id) ?? false}
                signedIn={savedIds !== null}
                locale={locale}
                nextPath={nextPath}
                labels={{
                  save: dict.detail.save,
                  saved: dict.detail.saved,
                  signIn: dict.detail.signInToSave,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
