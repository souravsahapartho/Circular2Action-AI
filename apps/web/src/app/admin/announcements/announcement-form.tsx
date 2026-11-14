'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export function AnnouncementForm({
  categories,
}: {
  categories: Array<{ slug: string; name: string }>;
}) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [audience, setAudience] = useState<'all' | 'category'>('all');
  const [category, setCategory] = useState(categories[0]?.slug ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const who =
          audience === 'all'
            ? 'everyone'
            : `people interested in ${categories.find((c) => c.slug === category)?.name ?? category}`;
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
          },
        );
        setBusy(false);
        if (out.ok && out.data) {
          setMsg({
            ok: true,
            text: `Sent to ${out.data.told} ${out.data.told === 1 ? 'person' : 'people'}.`,
          });
          setTitle('');
          setMessage('');
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
      <div className="field">
        <label htmlFor="an-aud">Send to</label>
        <select
          id="an-aud"
          className="input"
          value={audience}
          onChange={(e) => setAudience(e.target.value as 'all' | 'category')}
        >
          <option value="all">Everyone</option>
          <option value="category">People interested in one kind of opportunity</option>
        </select>
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
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Sending…' : 'Send announcement'}
      </button>
    </form>
  );
}
