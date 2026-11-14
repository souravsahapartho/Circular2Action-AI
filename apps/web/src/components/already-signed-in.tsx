'use client';

import Link from 'next/link';
import { callApi } from '@/lib/client-api';

const TEXT = {
  en: {
    title: 'You are already signed in',
    as: 'Signed in as',
    go: 'Continue',
    out: 'Sign out and use another account',
  },
  bn: {
    title: 'আপনি আগেই সাইন ইন করা আছেন',
    as: 'সাইন ইন করা অ্যাকাউন্ট',
    go: 'চালিয়ে যান',
    out: 'সাইন আউট করে অন্য অ্যাকাউন্ট ব্যবহার করুন',
  },
};

/** Shown instead of a silent redirect when someone opens sign-in or register while signed in. */
export function AlreadySignedIn({
  locale,
  email,
  continueHref,
  returnTo,
}: {
  locale: 'bn' | 'en';
  email: string;
  continueHref: string;
  returnTo: string;
}) {
  const t = TEXT[locale];
  return (
    <div className="stack">
      <p style={{ margin: 0 }}>
        <strong>{t.title}</strong>
      </p>
      <p className="muted" style={{ margin: 0 }}>
        {t.as}: {email}
      </p>
      <Link className="btn block" href={continueHref}>
        {t.go}
      </Link>
      <button
        type="button"
        className="btn secondary block"
        onClick={async () => {
          await callApi('POST', '/api/v1/auth/logout');
          window.location.assign(returnTo);
        }}
      >
        {t.out}
      </button>
    </div>
  );
}
