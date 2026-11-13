import { Anek_Bangla, Anek_Latin, Noto_Sans_Bengali } from 'next/font/google';

// Anek Bangla is the planned body font; Noto Sans Bengali is the DS-1 fallback until the legibility gate decides.
export const anekBangla = Anek_Bangla({
  subsets: ['bengali', 'latin'],
  variable: '--font-anek-bangla',
  display: 'swap',
});
export const anekLatin = Anek_Latin({
  subsets: ['latin'],
  variable: '--font-anek-latin',
  display: 'swap',
});
export const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-noto-bengali',
  display: 'swap',
  preload: false,
});

export const fontClasses = `${anekBangla.variable} ${anekLatin.variable} ${notoBengali.variable}`;
