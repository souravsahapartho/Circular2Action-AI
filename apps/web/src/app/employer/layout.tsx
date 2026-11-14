import type { Metadata, Viewport } from 'next';
import { fontClasses } from '@/lib/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: 'Employer portal · Circular2Action', template: '%s · Employer portal' },
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

/** The employer portal is English only, has no locale prefix and is never indexed. */
export default function EmployerRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontClasses}>
      <body className="portal">{children}</body>
    </html>
  );
}
