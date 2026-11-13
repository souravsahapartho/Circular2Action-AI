import { notFound } from 'next/navigation';
import { AuthShell } from '@/components/auth-shell';
import { ResetForm } from '@/components/auth-forms';
import { Alert } from '@/components/ui';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';

export const metadata = { robots: { index: false }, referrer: 'no-referrer' };

export default async function Reset({
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
    <AuthShell locale={locale} dict={d} path="/reset-password" title={d.auth.resetTitle}>
      {token.length >= 20 ? (
        <ResetForm locale={locale} token={token} labels={d.auth} errors={d.errors} />
      ) : (
        <Alert kind="error">{d.errors.GONE}</Alert>
      )}
    </AuthShell>
  );
}
