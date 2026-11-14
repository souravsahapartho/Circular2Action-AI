import Link from 'next/link';
import type { Dictionary } from '@/i18n/dictionaries';
import { safeHref } from '@/lib/api';
import { TrackButton } from './track-button';
import { Icon } from './ui';

/**
 * The "what now" actions for one opportunity: apply (official link), how to apply, track and the official circular.
 * Applications themselves are made on the official site; this product never submits one on the visitor's behalf.
 */
export function ApplyActions({
  d,
  locale,
  slug,
  opportunity,
  signedIn,
  trackedId,
  nextPath,
}: {
  d: Dictionary;
  locale: string;
  slug: string;
  opportunity: {
    id: string;
    application_url?: string | null;
    apply_mode?: string | undefined;
    source_url?: string | null;
    how_to_apply?: string | null;
  };
  signedIn: boolean;
  trackedId: string | null;
  nextPath: string;
}) {
  const apply = safeHref(opportunity.application_url);
  const official = safeHref(opportunity.source_url);
  const onSite = opportunity.apply_mode === 'site' || opportunity.apply_mode === 'both';
  return (
    <div className="stack">
      {onSite ? (
        <Link className="btn block" href={`/${locale}/opportunities/${slug}/apply`}>
          <Icon name="check" /> {d.apply.applyHere}
        </Link>
      ) : null}
      {apply ? (
        <a
          className={`btn${onSite ? ' secondary' : ''} block`}
          href={apply}
          rel="noopener nofollow"
          target="_blank"
        >
          <Icon name="external" /> {d.detail.applyNow}
        </a>
      ) : opportunity.how_to_apply ? (
        <Link
          className="btn secondary block"
          href={`/${locale}/opportunities/${slug}#how-to-apply`}
        >
          <Icon name="file" /> {d.detail.howToApplyLink}
        </Link>
      ) : onSite ? null : (
        <p className="muted small" style={{ margin: 0 }}>
          {d.detail.noApplyLink}
        </p>
      )}
      <TrackButton
        opportunityId={opportunity.id}
        signedIn={signedIn}
        locale={locale}
        nextPath={nextPath}
        initialTrackedId={trackedId}
        labels={{
          track: d.detail.track,
          tracking: d.detail.tracking,
          signIn: d.detail.signInToSave,
        }}
        errors={d.errors}
      />
      {official ? (
        <a className="btn ghost block" href={official} rel="noopener nofollow" target="_blank">
          <Icon name="file" /> {d.detail.official}
        </a>
      ) : null}
    </div>
  );
}
