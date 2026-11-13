import { notFound } from 'next/navigation';
import type { EligibilityStatus } from '@c2a/eligibility';
import { Page } from '@/components/chrome';
import { DeadlineChip, StatusBadge } from '@/components/states';
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
      <p style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <StatusBadge key={s} status={s} dict={d} />
        ))}
      </p>
      <h2>Deadline chips</h2>
      <p style={{ display: 'grid', gap: 8 }}>
        <DeadlineChip iso="2026-11-20T23:59:00+06:00" locale={locale} dict={d} now={now} />
        <DeadlineChip iso="2026-11-13T23:59:00+06:00" locale={locale} dict={d} now={now} />
        <DeadlineChip iso="2026-11-01T23:59:00+06:00" locale={locale} dict={d} now={now} />
      </p>
      <h2>Buttons and inputs</h2>
      <p style={{ display: 'flex', gap: 8 }}>
        <button className="btn" type="button">
          {d.home.searchButton}
        </button>
        <button className="btn secondary" type="button">
          {d.states.retry}
        </button>
      </p>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="sample">{d.signIn.email}</label>
        <input id="sample" className="input" />
      </div>
    </Page>
  );
}
