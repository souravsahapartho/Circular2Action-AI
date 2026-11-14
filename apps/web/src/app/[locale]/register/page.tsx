import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { RegisterForm } from '@/components/auth-forms';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { getMe } from '@/lib/session';

export const metadata = { robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function Register({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { locale } = await params;
  const type = (await searchParams).type === 'employer' ? 'employer' : 'seeker';
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  if (await getMe()) redirect(`/${locale}/app`);
  return (
    <AuthShell
      locale={locale}
      dict={d}
      path="/register"
      title={d.auth.registerTitle}
      lead={d.auth.registerLead}
    >
      <RegisterForm locale={locale} labels={d.auth} errors={d.errors} initialType={type} />
      <p className="muted" style={{ marginTop: 16 }}>
        {d.auth.haveAccount} <Link href={`/${locale}/sign-in`}>{d.auth.signInTitle}</Link>
      </p>
    </AuthShell>
  );
}
