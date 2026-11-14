'use client';

import { useEffect, type ReactNode } from 'react';
import { callApi } from '@/lib/client-api';

/**
 * Tells the API what a signed-in person looked at, so suggestions can improve. The API ignores it when the person
 * switched personalisation off. Failures are silent: this must never get in the way of reading a page.
 */
async function send(body: Record<string, string>): Promise<void> {
  try {
    await callApi('POST', '/api/v1/me/interactions', body);
  } catch {
    // ignored on purpose
  }
}

export function ViewBeacon({ opportunityId }: { opportunityId: string }) {
  useEffect(() => {
    const timer = setTimeout(
      () => void send({ kind: 'view', opportunity_id: opportunityId }),
      4000,
    );
    return () => clearTimeout(timer); // a quick bounce is not interest
  }, [opportunityId]);
  return null;
}

export function SearchBeacon({ term }: { term: string }) {
  useEffect(() => {
    if (term.trim().length >= 2) void send({ kind: 'search', term: term.trim().slice(0, 120) });
  }, [term]);
  return null;
}

/** An outbound link that records the click for the person's suggestions, then opens the original site. */
export function TrackedExternalLink({
  href,
  listingId,
  className,
  children,
}: {
  href: string;
  listingId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <a
      className={className}
      href={href}
      rel="noopener nofollow"
      target="_blank"
      onClick={() => void send({ kind: 'listing_click', listing_id: listingId })}
    >
      {children}
    </a>
  );
}
