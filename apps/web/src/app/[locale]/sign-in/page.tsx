import { notFound } from 'next/navigation';
import { Page } from '@/components/chrome';
import { isLocale } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { SignInForm } from './sign-in-form';

export const metadata = { robots: { index: false } };

export default async function SignIn({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const d = getDictionary(locale);
  return (
    <Page locale={locale} dict={d} section="other" path="/sign-in">
      <h1>{d.signIn.title}</h1>
      <SignInForm
        labels={{
          email: d.signIn.email,
          password: d.signIn.password,
          submit: d.signIn.submit,
          failed: d.signIn.failed,
          unavailable: d.signIn.unavailable,
        }}
      />
      <p>
        <span className="muted">{d.signIn.forgot}</span> ·{' '}
        <span className="muted">{d.signIn.register}</span>
      </p>
    </Page>
  );
}
