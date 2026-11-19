'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

type Audience = 'all' | 'seekers' | 'employers' | 'category' | 'user';

const AUDIENCES: Array<{ value: Audience; label: string; hint: string }> = [
  { value: 'seekers', label: 'Job seekers', hint: 'Everyone who signed up to find opportunities.' },
  {
    value: 'employers',
    label: 'Employers (recruiters)',
    hint: 'Everyone with an employer account.',
  },
  { value: 'all', label: 'Everyone', hint: 'Job seekers and employers.' },
  {
    value: 'category',
    label: 'People interested in one kind of opportunity',
    hint: 'They chose it, or looked at it in the last 90 days.',
  },
  { value: 'user', label: 'One person (by email)', hint: 'A private message to a single account.' },
];

/** The notification board: write one message and choose who receives it. */
export function AnnouncementForm({
  categories,
}: {
  categories: Array<{ slug: string; name: string }>;
}) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<Audience>('seekers');
  const [category, setCategory] = useState(categories[0]?.slug ?? '');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const current = AUDIENCES.find((a) => a.value === audience)!;

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const who =
          audience === 'category'
            ? `people interested in ${categories.find((c) => c.slug === category)?.name ?? category}`
            : audience === 'user'
              ? email.trim()
              : current.label.toLowerCase();
        if (!window.confirm(`Send this to ${who}? This cannot be undone.`)) return;
        setBusy(true);
        setMsg(null);
        const out = await callApi<{ told: number }>(
          'POST',
          '/api/v1/admin/notifications/broadcast',
          {
            title: title.trim(),
            message: message.trim(),
            audience,
            ...(audience === 'category' ? { category_slug: category } : {}),
            ...(audience === 'user' ? { email: email.trim() } : {}),
          },
        );
        setBusy(false);
        if (out.ok && out.data) {
          setMsg({
            ok: true,
            text:
              out.data.told === 0
                ? 'Nobody matched this audience, so nothing was sent.'
                : `Sent to ${out.data.told} ${out.data.told === 1 ? 'person' : 'people'}. Phones with push on are notified within seconds.`,
          });
          setTitle('');
          setMessage('');
          router.refresh();
        } else {
          setMsg({
            ok: false,
            text: out.error?.details?.[0]?.message ?? out.error?.message ?? 'Could not send.',
          });
        }
      }}
    >
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}
      <div className="field">
        <label htmlFor="an-aud">Send to</label>
        <select
          id="an-aud"
          className="input"
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
        >
          {AUDIENCES.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <span className="muted small">{current.hint}</span>
      </div>
      {audience === 'category' ? (
        <div className="field">
          <label htmlFor="an-cat">Kind</label>
          <select
            id="an-cat"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {audience === 'user' ? (
        <div className="field">
          <label htmlFor="an-email">Email address</label>
          <input
            id="an-email"
            className="input"
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="an-title">Title</label>
        <input
          id="an-title"
          className="input"
          value={title}
          maxLength={120}
          required
          minLength={3}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="an-msg">Message</label>
        <textarea
          id="an-msg"
          className="input"
          rows={4}
          maxLength={500}
          required
          minLength={3}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <span className="muted small">{message.length}/500</span>
      </div>
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send notification'}
      </button>
    </form>
  );
}
