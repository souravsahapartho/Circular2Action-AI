'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A <details> that starts open on wide screens and collapsed on phones (the server cannot know the screen size).
 * Used for the filters panel so a phone shows the results first.
 */
export function ResponsiveDetails({
  className,
  children,
  collapseBelow = 900,
}: {
  className?: string;
  children: ReactNode;
  collapseBelow?: number;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (window.matchMedia(`(max-width: ${collapseBelow - 1}px)`).matches) {
      ref.current?.removeAttribute('open');
    }
  }, [collapseBelow]);
  return (
    <details className={className} ref={ref} open>
      {children}
    </details>
  );
}
