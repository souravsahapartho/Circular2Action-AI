import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import { DEFAULT_LOCALE } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export default function NotFound() {
  const d = getDictionary(DEFAULT_LOCALE);
  return (
    <main id="main" className="container" style={{ padding: '64px 16px' }}>
      <EmptyState
        icon="search"
        title={`${d.static.notFoundTitle} · Page not found`}
        text={d.static.notFoundText}
        action={
          <>
            <Link className="btn" href="/bn">
              {d.nav.home}
            </Link>
            <Link className="btn secondary" href="/en">
              English
            </Link>
          </>
        }
      />
    </main>
  );
}
