import { notFound } from 'next/navigation';
import type { EligibilityStatus } from '@c2a/eligibility';
import { Page } from '@/components/chrome';
import { Alert, Badge, DeadlineChip, Icon, StatusBadge } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { title: 'Design system / DS-1', robots: { index: false } };

// Sample notice text written for this specimen (not copied from a real circular).
const SAMPLE =
  'আবেদনকারীর বয়স ২০২৬ সালের ১ ডিসেম্বর তারিখে ১৮ থেকে ৩০ বছরের মধ্যে হতে হবে। স্নাতক বা সমমানের ডিগ্রি এবং কম্পিউটার চালনায় দক্ষতা থাকতে হবে। আবেদন ফি ২০০ টাকা, অনলাইনে জমা দিতে হবে। লিখিত, ব্যবহারিক ও মৌখিক পরীক্ষার তারিখ পরে জানানো হবে।';

const FONTS = [
  { name: 'Anek Bangla', varName: '--font-anek-bangla' },
  { name: 'Noto Sans Bengali', varName: '--font-noto-bengali' },
];
const SIZES = [14, 15, 16];
const STATUSES: EligibilityStatus[] = [
  'eligible',
  'not_eligible',
  'needs_verification',
  'insufficient_information',
];

/** Gate DS-1 specimen: the same Bangla text in both candidate fonts at 14, 15 and 16 px, plus base components. */
export default async function Design({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const now = new Date('2026-11-13T00:00:00+06:00');
  return (
    <Page locale={locale} dict={d} section="other" path="/design">
      <h1>Design system · DS-1</h1>
      <h2>Bangla legibility specimen</h2>
      {FONTS.map((f) =>
        SIZES.map((px) => (
          <div key={`${f.name}-${px}`} className="specimen" lang="bn">
            <strong lang="en">
              {f.name} · {px}px
            </strong>
            <p style={{ fontFamily: `var(${f.varName})`, fontSize: px, lineHeight: 1.75 }}>
              {SAMPLE}
            </p>
          </div>
        )),
      )}
      <h2>Eligibility statuses</h2>
      <p className="row-flex">
        {STATUSES.map((s) => (
          <StatusBadge key={s} status={s} label={d.eligibility[s]} />
        ))}
      </p>
      <h2>Badges, deadline chips and alerts</h2>
      <p className="row-flex">
        <Badge>Brand</Badge>
        <Badge tone="success">Success</Badge>
        <Badge tone="warn">Warning</Badge>
        <Badge tone="danger">Danger</Badge>
        <Badge tone="info">Info</Badge>
        <DeadlineChip iso="2026-11-20T23:59:00+06:00" locale={locale} dict={d} now={now} />
        <DeadlineChip iso="2026-11-13T23:59:00+06:00" locale={locale} dict={d} now={now} />
        <DeadlineChip iso="2026-11-01T23:59:00+06:00" locale={locale} dict={d} now={now} />
      </p>
      <Alert kind="info">Information message</Alert>
      <Alert kind="success">Success message</Alert>
      <Alert kind="warn">Warning message</Alert>
      <Alert kind="error">Error message</Alert>
      <h2>Buttons and inputs</h2>
      <p className="row-flex">
        <button className="btn" type="button">
          <Icon name="search" /> {d.home.searchButton}
        </button>
        <button className="btn secondary" type="button">
          {d.states.retry}
        </button>
        <button className="btn ghost" type="button">
          {d.common.cancel}
        </button>
        <button className="btn danger" type="button">
          {d.common.delete}
        </button>
      </p>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="sample">{d.auth.email}</label>
        <input id="sample" className="input" />
      </div>
    </Page>
  );
}
