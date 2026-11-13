import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { ForgotForm } from '@/components/auth-forms';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false } };

export default async function Forgot({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <AuthShell
      locale={locale}
      dict={d}
      path="/forgot-password"
      title={d.auth.forgotTitle}
      lead={d.auth.forgotLead}
    >
      <ForgotForm labels={d.auth} errors={d.errors} />
      <p style={{ marginTop: 16 }}>
        <Link href={`/${locale}/sign-in`}>{d.auth.signInTitle}</Link>
      </p>
    </AuthShell>
  );
}
