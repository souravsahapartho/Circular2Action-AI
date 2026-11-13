import type { Metadata, Viewport } from 'next';
import { fontClasses } from '@/lib/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: 'Staff · Circular2Action', template: '%s · Staff' },
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** Admin is English only, has no locale prefix and is never indexed (plan 8.1). */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClasses}>
      <body>{children}</body>
    </html>
  );
}
