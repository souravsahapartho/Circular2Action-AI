import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { VerifyEmail } from '@/components/auth-forms';
import { Alert } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Verify({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  const token = (await searchParams).token ?? '';
  return (
    <AuthShell locale={locale} dict={d} path="/verify-email" title={d.auth.verifyTitle}>
      {token.length >= 20 ? (
        <VerifyEmail locale={locale} token={token} labels={d.auth} errors={d.errors} />
      ) : (
        <Alert kind="error">{d.auth.verifyFailed}</Alert>
      )}
    </AuthShell>
  );
}
