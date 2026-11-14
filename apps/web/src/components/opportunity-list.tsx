import Link from 'next/link';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import type { OpportunitySummary } from '@/lib/api';
import { reasonText, type Reason } from '@/lib/reasons';
import { SaveButton } from './save-button';
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
}) {
  return (
    <ul className="opp-list">
      {items.map((o) => {
        const chips = (reasons?.[o.id] ?? [])
          .map((r) => reasonText(dict, r, categoryNames ?? {}))
          .filter((x): x is string => x !== null);
        return (
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
