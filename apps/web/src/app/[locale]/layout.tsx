import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { isLocale, LOCALES } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import { fontClasses } from '@/lib/fonts';
import '../globals.css';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: '#0b5d5e', width: 'device-width', initialScale: 1 };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const d = getDictionary(locale);
  return {
    title: { default: d.meta.title, template: `%s · ${d.meta.title}` },
    description: d.meta.description,
    alternates: { languages: { bn: '/bn', en: '/en' } },
    icons: { icon: '/icon.svg' },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} className={fontClasses}>
      <body>{children}</body>
    </html>
  );
}
