'use client';

import { useCallback, useEffect, useState } from 'react';
import { callApi } from '@/lib/client-api';

const TEXT = {
  en: {
    title: 'Phone and browser notifications',
    lead: 'Get alerts even when this site is closed: new matches, closing deadlines and updates on your applications.',
    unsupported:
      'This browser does not support push notifications. Try Chrome, Edge, Firefox or Safari 16.4+ (on iPhone, add the site to your Home Screen first).',
    unavailable: 'Push notifications are not switched on for this site yet.',
    denied:
      'Notifications are blocked for this site. Allow them in your browser settings, then reload.',
    enable: 'Turn on notifications',
    disable: 'Turn off on this device',
    on: 'On for this device',
    test: 'Send a test',
    tested: 'Test sent. It should appear in a moment.',
    types: 'Tell me about',
    busy: 'Please wait…',
    failed: 'Could not change this. Please try again.',
    kinds: {
      job_match: 'New matches',
      deadline_reminder: 'Closing deadlines',
      application_update: 'My application updates',
      new_application: 'New applications to my posts',
      announcement: 'Announcements',
    },
  },
  bn: {
    title: 'ফোন ও ব্রাউজার নোটিফিকেশন',
    lead: 'সাইট বন্ধ থাকলেও জানুন: নতুন মিল, শেষ তারিখ এবং আবেদনের আপডেট।',
    unsupported:
      'এই ব্রাউজারে পুশ নোটিফিকেশন চলে না। Chrome, Edge, Firefox বা Safari 16.4+ ব্যবহার করুন (আইফোনে আগে সাইটটি হোম স্ক্রিনে যোগ করুন)।',
    unavailable: 'এই সাইটে পুশ নোটিফিকেশন এখনো চালু হয়নি।',
    denied: 'এই সাইটের নোটিফিকেশন ব্লক করা আছে। ব্রাউজার সেটিংসে অনুমতি দিয়ে পাতা রিলোড করুন।',
    enable: 'নোটিফিকেশন চালু করুন',
    disable: 'এই ডিভাইসে বন্ধ করুন',
    on: 'এই ডিভাইসে চালু আছে',
    test: 'পরীক্ষা পাঠান',
    tested: 'পরীক্ষা পাঠানো হয়েছে, একটু পরেই দেখা যাবে।',
    types: 'যা যা জানাবে',
    busy: 'অপেক্ষা করুন…',
    failed: 'পরিবর্তন করা যায়নি। আবার চেষ্টা করুন।',
    kinds: {
      job_match: 'নতুন মিল',
      deadline_reminder: 'শেষ তারিখ',
      application_update: 'আমার আবেদনের আপডেট',
      new_application: 'আমার পোস্টে নতুন আবেদন',
      announcement: 'ঘোষণা',
    },
  },
};

type Kind = keyof (typeof TEXT)['en']['kinds'];

function keyToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

interface PushState {
  available: boolean;
  public_key: string | null;
  devices: number;
  disabled_types: string[];
}

/** Lets a person turn push notifications on or off for this device and choose which kinds they want. */
export function PushToggle({
  locale = 'en',
  employer = false,
}: {
  locale?: 'bn' | 'en';
  employer?: boolean;
}) {
  const t = TEXT[locale];
  const [state, setState] = useState<PushState | null>(null);
  const [supported, setSupported] = useState(true);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [here, setHere] = useState(false); // this device is subscribed
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ok =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    const out = await callApi<PushState>('GET', '/api/v1/me/push');
    if (out.ok && out.data) setState(out.data);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      setHere(Boolean(reg && (await reg.pushManager.getSubscription())));
    } catch {
      setHere(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enable() {
    if (!state?.public_key) return;
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') return;
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(state.public_key) as BufferSource,
        }));
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const out = await callApi('POST', '/api/v1/me/push/subscribe', {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      });
      if (!out.ok) setMsg(t.failed);
    } catch {
      setMsg(t.failed);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await callApi('POST', '/api/v1/me/push/unsubscribe', { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
    } catch {
      setMsg(t.failed);
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function toggleType(kind: Kind, enabled: boolean) {
    setState((s) =>
      s
        ? {
            ...s,
            disabled_types: enabled
              ? s.disabled_types.filter((x) => x !== kind)
              : [...s.disabled_types, kind],
          }
        : s,
    );
    const out = await callApi('PUT', '/api/v1/me/push/types', { type: kind, enabled });
    if (!out.ok) {
      setMsg(t.failed);
      await refresh();
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const out = await callApi('POST', '/api/v1/me/push/test');
    setMsg(out.ok ? t.tested : t.failed);
    setBusy(false);
  }

  const kinds: Kind[] = employer
    ? ['new_application', 'announcement']
    : ['job_match', 'deadline_reminder', 'application_update', 'announcement'];

  return (
    <section className="panel push-panel" aria-labelledby="push-title">
      <h2 id="push-title">{t.title}</h2>
      <p className="muted">{t.lead}</p>
      {!supported ? (
        <p role="note">{t.unsupported}</p>
      ) : state && !state.available ? (
        <p role="note">{t.unavailable}</p>
      ) : permission === 'denied' ? (
        <p role="alert">{t.denied}</p>
      ) : (
        <>
          <div className="row-flex">
            {here ? (
              <>
                <span className="badge success">{t.on}</span>
                <button type="button" className="btn secondary sm" disabled={busy} onClick={test}>
                  {t.test}
                </button>
                <button
                  type="button"
                  className="btn secondary sm"
                  disabled={busy}
                  onClick={disable}
                >
                  {t.disable}
                </button>
              </>
            ) : (
              <button type="button" className="btn" disabled={busy || !state} onClick={enable}>
                {busy ? t.busy : t.enable}
              </button>
            )}
          </div>
          {here && state ? (
            <fieldset className="push-types">
              <legend>{t.types}</legend>
              {kinds.map((k) => (
                <label key={k} className="check">
                  <input
                    type="checkbox"
                    checked={!state.disabled_types.includes(k)}
                    onChange={(e) => void toggleType(k, e.target.checked)}
                  />{' '}
                  <span>{t.kinds[k]}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </>
      )}
      {msg ? (
        <p role="status" className="small">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
