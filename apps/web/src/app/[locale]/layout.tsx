import type { Metadata } from 'next';
import { Anek_Bangla, Anek_Latin, Noto_Sans_Bengali } from 'next/font/google';
import { notFound } from 'next/navigation';
import { isLocale, LOCALES } from '@/i18n/config';
import { getDictionary } from '@/i18n/dictionaries';
import '../globals.css';

// Anek Bangla is the planned body font; Noto Sans Bengali is the DS-1 fallback until the legibility gate decides.
const anekBangla = Anek_Bangla({
  subsets: ['bengali', 'latin'],
  variable: '--font-anek-bangla',
  display: 'swap',
});
const anekLatin = Anek_Latin({
  subsets: ['latin'],
  variable: '--font-anek-latin',
  display: 'swap',
});
const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-noto-bengali',
  display: 'swap',
  preload: false,
});

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

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
    <html
      lang={locale}
      className={`${anekBangla.variable} ${anekLatin.variable} ${notoBengali.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
