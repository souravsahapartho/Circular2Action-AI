import Link from 'next/link';

export interface Analytics {
  totals: {
    users: number;
    published_opportunities: number;
    site_applications: number;
    web_listings: number;
    notifications: number;
    activity_30d: number;
    people_with_alerts: number;
  };
  signups_14d: Array<{ day: string; n: number }>;
  applications_14d: Array<{ day: string; n: number }>;
  funnel: Record<string, number>;
  by_category: Array<{ slug: string; name: string; opportunities: number; applications: number }>;
  top_opportunities: Array<{
    id: string;
    title: string;
    title_alt: string | null;
    applications: number;
    saves: number;
  }>;
  web_by_source: Array<{ source: string; n: number }>;
  activity_30d: Array<{ kind: string; n: number }>;
}

const FUNNEL = [
  ['submitted', 'Submitted'],
  ['under_review', 'Under review'],
  ['shortlisted', 'Shortlisted'],
  ['interview', 'Interview'],
  ['accepted', 'Accepted'],
  ['rejected', 'Not selected'],
  ['withdrawn', 'Withdrawn'],
] as const;

const KIND_LABEL: Record<string, string> = {
  view: 'Views',
  search: 'Searches',
  listing_click: 'Web job clicks',
  save: 'Saves',
  track: 'Tracked',
  apply: 'Applications',
};

/** A column chart with one bar per day, drawn with plain elements so it scales with the screen. */
export function DayChart({
  title,
  data,
  tone = 'brand',
}: {
  title: string;
  data: Array<{ day: string; n: number }>;
  tone?: 'brand' | 'marigold';
}) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const total = data.reduce((n, d) => n + d.n, 0);
  return (
    <section className="panel">
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <span className="muted small">{total} in 14 days</span>
      </div>
      <div className="daychart" role="img" aria-label={`${title}: ${total} in the last 14 days`}>
        {data.map((d) => (
          <div key={d.day} className="daybar" title={`${d.day}: ${d.n}`}>
            <span className={`fill ${tone}`} style={{ height: `${(d.n / max) * 100}%` }} />
            <span className="lab">{d.day.slice(8)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Bars({
  rows,
  tone = 'brand',
}: {
  rows: Array<{ label: string; n: number; href?: string }>;
  tone?: 'brand' | 'marigold';
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} className="bar-row">
          <span>{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</span>
          <span className="bar">
            <span
              className={tone === 'marigold' ? 'm' : undefined}
              style={{ width: `${(r.n / max) * 100}%` }}
            />
          </span>
          <span className="tabular">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

/** The analytics section of the staff dashboard. */
export function AdminCharts({ a }: { a: Analytics }) {
  return (
    <>
      <div className="panel-grid two-equal" style={{ marginTop: 16 }}>
        <DayChart title="New accounts" data={a.signups_14d} />
        <DayChart title="Applications" data={a.applications_14d} tone="marigold" />
      </div>
      <div className="panel-grid three" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Application funnel</h2>
          <Bars
            rows={FUNNEL.map(([k, label]) => ({
              label,
              n: a.funnel[k] ?? 0,
              href: `/admin/applications?status=${k}`,
            }))}
          />
        </section>
        <section className="panel">
          <h2>By category</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            Published opportunities
          </p>
          <Bars rows={a.by_category.map((c) => ({ label: c.name, n: c.opportunities }))} />
          <p className="muted small" style={{ marginBottom: 0 }}>
            Applications
          </p>
          <Bars
            tone="marigold"
            rows={a.by_category.map((c) => ({ label: c.name, n: c.applications }))}
          />
        </section>
        <section className="panel">
          <h2>What people do (30 days)</h2>
          <Bars
            rows={a.activity_30d
              .sort((x, y) => y.n - x.n)
              .map((x) => ({ label: KIND_LABEL[x.kind] ?? x.kind, n: x.n }))}
          />
          {a.activity_30d.length === 0 ? (
            <p className="muted small">No activity recorded yet.</p>
          ) : null}
          <p className="muted small" style={{ marginBottom: 0 }}>
            {a.totals.people_with_alerts} people have alerts on · {a.totals.notifications}{' '}
            notifications sent
          </p>
        </section>
      </div>
      <div className="panel-grid two-equal" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Most wanted opportunities</h2>
          {a.top_opportunities.length === 0 ? (
            <p className="muted">Nothing published yet.</p>
          ) : (
            <ol className="rank-list">
              {a.top_opportunities.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/opportunities/${o.id}`}>{o.title_alt ?? o.title}</Link>
                  <span className="muted small">
                    {o.applications} applications · {o.saves} saves
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="panel">
          <h2>Jobs from the web</h2>
          <Bars rows={a.web_by_source.map((s) => ({ label: s.source, n: s.n }))} />
          {a.web_by_source.length === 0 ? (
            <p className="muted small">No listings fetched yet.</p>
          ) : null}
          <p style={{ marginBottom: 0 }}>
            <Link href="/admin/listings">Manage web listings</Link>
          </p>
        </section>
      </div>
    </>
  );
}
