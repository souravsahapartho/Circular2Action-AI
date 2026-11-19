'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { callApi } from '@/lib/client-api';

/** A link to a sponsored post that counts the click (best effort, never blocks the visit). */
export function SponsoredLink({
  id,
  href,
  children,
}: {
  id: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} onClick={() => void callApi('POST', `/api/v1/sponsored/${id}/click`, {})}>
      {children}
    </Link>
  );
}
