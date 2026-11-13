import { notFound } from 'next/navigation';
import type { EligibilityStatus } from '@c2a/eligibility';
import { Page } from '@/components/chrome';
import { EmptyState, StatusBadge } from '@/components/states';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false } };
const ORDER: EligibilityStatus[] = [
  'eligible',
  'not_eligible',
  'needs_verification',
  'insufficient_information',
];

/**
 * Eligibility result for one opportunity. The result needs a signed-in profile (Module C); until the auth and
 * profile modules ship, the page explains that and shows the four statuses the engine can return.
 */
export default async function Eligibility({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="explore" path={`/opportunities/${slug}/eligibility`}>
      <h1>{d.eligibility.title}</h1>
      <EmptyState title={d.app.signInRequired} text={d.eligibility.signInNeeded} />
      <h2>{d.eligibility.rules}</h2>
      <ul className="rows" aria-label={d.eligibility.rules}>
        {ORDER.map((s) => (
          <li key={s} className="row" style={{ gridTemplateColumns: '1fr' }}>
            <StatusBadge status={s} dict={d} />
          </li>
        ))}
      </ul>
      <p className="muted">{d.eligibility.disclaimer}</p>
    </Page>
  );
}
