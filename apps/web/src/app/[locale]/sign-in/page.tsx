import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { SignInForm, safeNext } from '@/components/auth-forms';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getMe } from '@/lib/session';

export const metadata = { robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function SignIn({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ next?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const next = (await searchParams).next ?? null;
  const me = await getMe();
  if (me) redirect(safeNext(next, me.staff ? '/admin' : `/${locale}/app`));
  return (
    <AuthShell
      locale={locale}
      dict={d}
      path="/sign-in"
      title={d.auth.signInTitle}
      lead={d.auth.signInLead}
    >
      <SignInForm locale={locale} next={next} labels={d.auth} errors={d.errors} />
      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/forgot-password`}>{d.auth.forgot}</Link>
      </p>
      <p className="muted">
        {d.auth.noAccount} <Link href={`/${locale}/register`}>{d.auth.registerLink}</Link>
      </p>
    </AuthShell>
  );
}
