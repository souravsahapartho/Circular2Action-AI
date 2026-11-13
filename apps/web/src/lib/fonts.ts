import { Inter, Noto_Sans_Bengali } from 'next/font/google';

// Inter for Latin text and Noto Sans Bengali for Bangla: neutral, widely used UI faces with full weight ranges.
export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});
export const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali', 'latin'],
  variable: '--font-noto-bengali',
  display: 'swap',
});

export const fontClasses = `${inter.variable} ${notoBengali.variable}`;
