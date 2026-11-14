'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Alert } from '@/components/ui';
import { callApi } from '@/lib/client-api';

export interface SourceInfo {
  id: string;
  label: string;
  homepage: string;
  enabled: boolean;
  needs: string | null;
  listings: number;
  last_run: { at: string; ok: boolean; fetched: number; error: string | null } | null;
}

export interface ListingRow {
  id: string;
  source: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  posted_at: string | null;
  fetched_at: string;
  hidden: boolean;
}

const fmt = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dhaka',
  }).format(new Date(iso));

export function ListingsPanel({
  initialSources,
  rows,
  total,
  page,
  pageSize,
  q,
  source,
}: {
  initialSources: SourceInfo[];
  rows: ListingRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  source: string | undefined;
}) {
  const router = useRouter();
  const [sources, setSources] = useState(initialSources);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function refresh(only?: string) {
    setBusy(only ?? 'all');
    setMsg(null);
    const out = await callApi<{
      results: Array<{ source: string; ok: boolean; fetched: number; error?: string }>;
      sources: SourceInfo[];
    }>('POST', '/api/v1/admin/listings/refresh', only ? { source: only } : {});
    setBusy(null);
    if (out.ok && out.data) {
      setSources(out.data.sources);
      const bad = out.data.results.filter((r) => !r.ok);
      setMsg(
        bad.length === 0
          ? {
              ok: true,
              text: `Fetched ${out.data.results.reduce((n, r) => n + r.fetched, 0)} listings.`,
            }
          : {
              ok: false,
              text: bad.map((b) => `${b.source}: ${b.error ?? 'failed'}`).join(' · '),
            },
      );
      router.refresh();
    } else setMsg({ ok: false, text: out.error?.message ?? 'Could not refresh.' });
  }

  async function toggle(row: ListingRow) {
    setBusy(row.id);
    const out = await callApi('POST', `/api/v1/admin/listings/${row.id}/hidden`, {
      hidden: !row.hidden,
    });
    setBusy(null);
    if (out.ok) router.refresh();
    else setMsg({ ok: false, text: out.error?.message ?? 'Could not change visibility.' });
  }

  const link = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const m = { q: q || undefined, source, page: undefined, ...over };
    for (const [k, v] of Object.entries(m)) if (v) p.set(k, v);
    return `/admin/listings${p.toString() ? `?${p}` : ''}`;
  };

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0, maxWidth: '75ch' }}>
        Jobs found on the web are fetched from the sources below, cached here and shown on the
        public site as <strong>From the web · not verified</strong>, with a link to the original.
        Hide any listing that should not appear.
      </p>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}

      <div className="grid-2">
        {sources.map((s) => (
          <div key={s.id} className={`source-card${s.enabled ? '' : ' off'}`}>
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <strong>
                <span
                  className={
                    s.enabled ? (s.last_run?.ok === false ? 'dot-bad' : 'dot-ok') : 'dot-off'
                  }
                />
                {s.label}
              </strong>
              <span className="muted small">{s.listings} visible</span>
            </div>
            {s.enabled ? (
              <>
                <p className="muted small" style={{ margin: 0 }}>
                  {s.last_run
                    ? `Last run ${fmt(s.last_run.at)}: ${
                        s.last_run.ok
                          ? `${s.last_run.fetched} fetched`
                          : `failed (${s.last_run.error})`
                      }`
                    : 'Not run yet. It runs by itself when the public feed is opened, or use the button.'}
                </p>
                <div>
                  <button
                    type="button"
                    className="btn secondary sm"
                    disabled={busy !== null}
                    onClick={() => void refresh(s.id)}
                  >
                    {busy === s.id ? 'Fetching…' : 'Refresh now'}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Off. Needs {s.needs}. Set it on the API service to switch this source on.
              </p>
            )}
          </div>
        ))}
      </div>
      <div>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void refresh()}
        >
          {busy === 'all' ? 'Fetching…' : 'Refresh all sources'}
        </button>
      </div>

      <form className="row-flex">
        <label htmlFor="lq" className="sr-only">
          Search
        </label>
        <input
          id="lq"
          name="q"
          className="input"
          style={{ maxWidth: 320 }}
          placeholder="Search title, company or place"
          defaultValue={q}
        />
        <select
          name="source"
          className="input"
          style={{ maxWidth: 200 }}
          defaultValue={source ?? ''}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <div className="panel">
          <p className="muted" style={{ margin: 0 }}>
            No listings yet. Use “Refresh all sources” to fetch them now.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Listing</th>
                <th>Source</th>
                <th>Posted</th>
                <th>Visible</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={r.hidden ? { opacity: 0.6 } : undefined}>
                  <td>
                    <a href={r.url} target="_blank" rel="noopener nofollow">
                      {r.title}
                    </a>
                    <br />
                    <span className="muted small">
                      {[r.company, r.location].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="small">{r.source}</td>
                  <td className="small">{r.posted_at ? fmt(r.posted_at) : '–'}</td>
                  <td>
                    <button
                      type="button"
                      className={`btn sm ${r.hidden ? '' : 'secondary'}`}
                      disabled={busy !== null}
                      onClick={() => void toggle(r)}
                    >
                      {r.hidden ? 'Show' : 'Hide'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > pageSize ? (
        <nav className="pagination" aria-label="Pagination">
          {page > 1 ? (
            <Link className="btn secondary sm" href={link({ page: String(page - 1) })}>
              ← Previous
            </Link>
          ) : null}
          <span className="muted tabular">
            {page} / {Math.ceil(total / pageSize)}
          </span>
          {page * pageSize < total ? (
            <Link className="btn secondary sm" href={link({ page: String(page + 1) })}>
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
