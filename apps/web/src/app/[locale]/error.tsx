'use client';

import { Icon } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="container" style={{ padding: '64px 16px' }}>
      <section className="state" role="alert">
        <Icon name="alert" />
        <h2>Something went wrong · কিছু একটা সমস্যা হয়েছে</h2>
        <p className="muted">
          The service may be waking up. Please try again. · সার্ভিস চালু হচ্ছে হয়তো, আবার চেষ্টা করুন।
        </p>
        <button className="btn" type="button" onClick={reset}>
          Try again · আবার চেষ্টা করুন
        </button>
      </section>
    </main>
  );
}
