import type { ReactNode } from 'react';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { getMe } from '@/lib/session';
import { Page } from './chrome';

/** Centered card layout shared by the sign-in, register and password pages. */
export async function AuthShell({
  locale,
  dict,
  path,
  title,
  lead,
  children,
}: {
  locale: Locale;
  dict: Dictionary;
  path: string;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  const me = await getMe();
  return (
    <Page locale={locale} dict={dict} section="other" path={path} me={me}>
      <div className="panel-narrow">
        <div className="card">
          <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
          {lead ? <p className="muted">{lead}</p> : null}
          {children}
        </div>
      </div>
    </Page>
  );
}
