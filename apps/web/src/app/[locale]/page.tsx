import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="home" path="">
      <h1>{d.home.title}</h1>
      <p className="muted" style={{ maxWidth: '65ch' }}>
        {d.home.lead}
      </p>
      <form action={`/${locale}/search`} role="search" className="searchbar">
        <label htmlFor="q" className="sr-only">
          {d.home.searchLabel}
        </label>
        <input id="q" name="q" className="input" placeholder={d.home.searchPlaceholder} />
        <button className="btn" type="submit">
          {d.home.searchButton}
        </button>
      </form>
      <div className="tiles">
        <section className="tile">
          <h2>
            <Link href={`/${locale}/opportunities`}>{d.home.tileFind}</Link>
          </h2>
          <p className="muted">{d.home.tileFindText}</p>
        </section>
        <section className="tile">
          <h2>{d.home.tileCheck}</h2>
          <p className="muted">{d.home.tileCheckText}</p>
        </section>
        <section className="tile">
          <h2>
            <Link href={`/${locale}/app/tracker`}>{d.home.tileTrack}</Link>
          </h2>
          <p className="muted">{d.home.tileTrackText}</p>
        </section>
      </div>
    </Page>
  );
}
