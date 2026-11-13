'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Badge, Icon } from '@/components/ui';
import { callApi, fieldErrors, type ApiOutcome } from '@/lib/client-api';

export interface AdminOpp {
  id: string;
  title: string;
  title_alt: string | null;
  organization_id: string;
  category_slug: string;
  position_title: string | null;
  summary_bn: string | null;
  summary_en: string | null;
  vacancies: number | null;
  deadline_at: string | null;
  location_slug: string | null;
  official_url: string | null;
  application_url: string | null;
  how_to_apply: string | null;
  required_documents: Array<{ label: string; note?: string }> | null;
  publication_status: string;
  verification_state: string;
  updated_at: string;
  requirements: Array<{
    id: string;
    rule_type: string;
    necessity: string;
    params: Record<string, unknown>;
    text: string | null;
  }>;
}

type ReqType = 'age' | 'education_level' | 'result' | 'experience_years' | 'custom';
interface Req {
  type: ReqType;
  necessity: 'mandatory' | 'preferred';
  min: string;
  max: string;
  asOf: string;
  level: string;
  scale: string;
  text: string;
}

const LEVELS: Array<[string, string]> = [
  ['ssc', 'SSC or equivalent'],
  ['hsc', 'HSC or equivalent'],
  ['diploma', 'Diploma'],
  ['bachelor', 'Bachelor degree'],
  ['masters', 'Masters degree'],
  ['mphil', 'MPhil'],
  ['phd', 'PhD'],
];

const emptyReq = (): Req => ({
  type: 'education_level',
  necessity: 'mandatory',
  min: '',
  max: '',
  asOf: '',
  level: 'bachelor',
  scale: 'gpa4',
  text: '',
});

function fromApi(r: AdminOpp['requirements'][number]): Req {
  const p = r.params;
  const type =
    (['age', 'education_level', 'result', 'experience_years'] as const).find(
      (t) => t === r.rule_type,
    ) ?? 'custom';
  return {
    type,
    necessity: r.necessity === 'preferred' ? 'preferred' : 'mandatory',
    min: p.min === undefined ? '' : String(p.min),
    max: p.max === undefined ? '' : String(p.max),
    asOf: typeof p.as_of === 'string' ? p.as_of : '',
    level: typeof p.min_level === 'string' ? p.min_level : 'bachelor',
    scale: typeof p.scale === 'string' ? p.scale : 'gpa4',
    text: r.text ?? '',
  };
}

function toApi(r: Req) {
  const n = (v: string) => Number(v);
  switch (r.type) {
    case 'age': {
      const params: Record<string, unknown> = { as_of: r.asOf };
      if (r.min) params.min = n(r.min);
      if (r.max) params.max = n(r.max);
      const text =
        r.text ||
        `Age ${r.min ? `at least ${r.min}` : ''}${r.min && r.max ? ' and ' : ''}${r.max ? `at most ${r.max}` : ''} years on ${r.asOf}`;
      return { rule_type: 'age', necessity: r.necessity, params, text };
    }
    case 'education_level': {
      const label = LEVELS.find(([v]) => v === r.level)?.[1] ?? r.level;
      return {
        rule_type: 'education_level',
        necessity: r.necessity,
        params: { min_level: r.level },
        text: r.text || `${label} or higher`,
      };
    }
    case 'result':
      return {
        rule_type: 'result',
        necessity: r.necessity,
        params: { scale: r.scale, min: n(r.min) },
        text:
          r.text ||
          `Result at least ${r.min} (${r.scale === 'gpa4' ? 'CGPA out of 4' : r.scale === 'gpa5' ? 'CGPA out of 5' : 'percent'})`,
      };
    case 'experience_years':
      return {
        rule_type: 'experience_years',
        necessity: r.necessity,
        params: { min: n(r.min) },
        text: r.text || `At least ${r.min} year(s) of experience`,
      };
    default:
      return { rule_type: 'custom', necessity: r.necessity, params: {}, text: r.text };
  }
}

const reqValid = (r: Req) =>
  r.type === 'custom'
    ? r.text.trim().length > 0
    : r.type === 'age'
      ? /^\d{4}-\d{2}-\d{2}$/.test(r.asOf) && (r.min !== '' || r.max !== '')
      : r.type === 'education_level'
        ? true
        : r.min !== '' && Number.isFinite(Number(r.min));

const TONE: Record<string, 'success' | 'neutral' | 'warn' | 'danger' | 'info'> = {
  published: 'success',
  draft: 'neutral',
  unpublished: 'warn',
  removed: 'danger',
};

export function OpportunityForm({
  mode,
  initial,
  categories,
  locations,
  organizations,
  canPublish,
  canRemove,
}: {
  mode: 'create' | 'edit';
  initial?: AdminOpp;
  categories: Array<{ slug: string; name: string }>;
  locations: Array<{ slug: string; name: string }>;
  organizations: Array<{ id: string; name: string }>;
  canPublish: boolean;
  canRemove?: boolean;
}) {
  const [opp, setOpp] = useState(initial);
  const [f, setF] = useState({
    title: initial?.title ?? '',
    title_alt: initial?.title_alt ?? '',
    organization_id: initial?.organization_id ?? '',
    category_slug: initial?.category_slug ?? 'jobs',
    position_title: initial?.position_title ?? '',
    summary_bn: initial?.summary_bn ?? '',
    summary_en: initial?.summary_en ?? '',
    vacancies: initial?.vacancies ? String(initial.vacancies) : '',
    deadline_date: initial?.deadline_at
      ? new Date(new Date(initial.deadline_at).getTime() + 6 * 3_600_000).toISOString().slice(0, 10)
      : '',
    location_slug: initial?.location_slug ?? '',
    official_url: initial?.official_url ?? '',
    application_url: initial?.application_url ?? '',
    how_to_apply: initial?.how_to_apply ?? '',
    documents: (initial?.required_documents ?? []).map((d) => d.label).join('\n'),
  });
  const [reqs, setReqs] = useState<Req[]>((initial?.requirements ?? []).map(fromApi));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const failure = (out: ApiOutcome<unknown>) => {
    setFe(fieldErrors(out));
    const code = out.error?.code;
    setMsg({
      ok: false,
      text:
        code === 'EDIT_CONFLICT'
          ? 'Someone else changed this opportunity. Reload the page to see their changes.'
          : code === 'FORBIDDEN'
            ? 'You do not have permission for that.'
            : code === 'MFA_REQUIRED' || code === 'UNAUTHENTICATED'
              ? 'Your staff session ended. Sign in again.'
              : (out.error?.message ?? 'Something went wrong.'),
    });
  };

  function payload() {
    const invalid = reqs.findIndex((r) => !reqValid(r));
    if (invalid >= 0) return `Requirement ${invalid + 1} is incomplete.`;
    const docs = f.documents
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label) => ({ label }));
    return {
      title: f.title.trim(),
      title_alt: f.title_alt.trim() || null,
      organization_id: f.organization_id,
      category_slug: f.category_slug,
      position_title: f.position_title.trim() || null,
      summary_bn: f.summary_bn.trim() || null,
      summary_en: f.summary_en.trim() || null,
      vacancies: f.vacancies ? Number(f.vacancies) : null,
      deadline_date: f.deadline_date || null,
      location_slug: f.location_slug || null,
      official_url: f.official_url.trim() || null,
      application_url: f.application_url.trim() || null,
      how_to_apply: f.how_to_apply.trim() || null,
      required_documents: docs.length ? docs : null,
      requirements: reqs.map(toApi),
    };
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setFe({});
    const body = payload();
    if (typeof body === 'string') return setMsg({ ok: false, text: body });
    if (!body.organization_id)
      return setMsg({ ok: false, text: 'Choose an organisation (or create one first).' });
    setBusy(true);
    if (mode === 'create') {
      const out = await callApi<{ id: string }>('POST', '/api/v1/admin/opportunities', body);
      setBusy(false);
      if (out.ok && out.data) window.location.assign(`/admin/opportunities/${out.data.id}`);
      else failure(out);
    } else {
      const out = await callApi<AdminOpp>('PATCH', `/api/v1/admin/opportunities/${opp!.id}`, {
        ...body,
        updated_at: opp!.updated_at,
      });
      setBusy(false);
      if (out.ok && out.data) {
        setOpp(out.data);
        setMsg({ ok: true, text: 'Saved.' });
      } else failure(out);
    }
  }

  async function act(action: 'publish' | 'unpublish' | 'remove') {
    if (!opp) return;
    const reason =
      action === 'publish'
        ? undefined
        : (window.prompt(`Reason for ${action} (shown in the audit log):`) ?? null);
    if (reason === null) return;
    if (
      action === 'remove' &&
      !window.confirm('Remove this opportunity for good? It disappears from the site.')
    )
      return;
    setBusy(true);
    setMsg(null);
    const out = await callApi<AdminOpp>(
      'POST',
      `/api/v1/admin/opportunities/${opp.id}/${action}`,
      reason ? { reason } : {},
    );
    setBusy(false);
    if (out.ok && out.data) {
      setOpp(out.data);
      setMsg({
        ok: true,
        text:
          action === 'publish' ? 'Published. It is now visible on the site.' : `Done: ${action}.`,
      });
    } else failure(out);
  }

  const updateReq = (i: number, patch: Partial<Req>) =>
    setReqs((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <form onSubmit={(e) => void save(e)} className="stack" noValidate>
      {msg ? <Alert kind={msg.ok ? 'success' : 'error'}>{msg.text}</Alert> : null}

      {opp ? (
        <div className="card row-flex" style={{ justifyContent: 'space-between' }}>
          <div className="row-flex">
            <Badge tone={TONE[opp.publication_status] ?? 'neutral'}>{opp.publication_status}</Badge>
            <span className="muted small">
              {opp.verification_state === 'verified_official'
                ? 'Verified against the official circular'
                : 'Not yet verified'}
            </span>
          </div>
          <div className="row-flex">
            {opp.publication_status === 'published' ? (
              <Link
                className="btn secondary sm"
                href={`/en/opportunities/x-${opp.id}`}
                target="_blank"
              >
                <Icon name="external" size="sm" /> View on site
              </Link>
            ) : null}
            {canPublish && opp.publication_status !== 'published' ? (
              <button
                type="button"
                className="btn sm"
                disabled={busy}
                onClick={() => void act('publish')}
              >
                <Icon name="check" size="sm" /> Publish
              </button>
            ) : null}
            {canPublish && opp.publication_status === 'published' ? (
              <button
                type="button"
                className="btn secondary sm"
                disabled={busy}
                onClick={() => void act('unpublish')}
              >
                Unpublish
              </button>
            ) : null}
            {canRemove && opp.publication_status !== 'removed' ? (
              <button
                type="button"
                className="btn danger sm"
                disabled={busy}
                onClick={() => void act('remove')}
              >
                Remove
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {mode === 'edit' && !canPublish ? (
        <Alert kind="info">
          You can edit this draft. A verifier publishes it after checking it against the official
          circular.
        </Alert>
      ) : null}

      <section className="card">
        <h2>Circular</h2>
        <div className="form-grid two">
          <div className={`field${fe.title ? ' invalid' : ''}`} style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="o-title">Title (as written in the circular)</label>
            <input
              id="o-title"
              className="input"
              value={f.title}
              maxLength={500}
              onChange={(e) => set('title', e.target.value)}
            />
            {fe.title ? <span className="field-error">{fe.title}</span> : null}
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="o-alt">Title in the other language (optional)</label>
            <input
              id="o-alt"
              className="input"
              value={f.title_alt}
              maxLength={500}
              onChange={(e) => set('title_alt', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="o-org">Organisation</label>
            <select
              id="o-org"
              className="input"
              value={f.organization_id}
              onChange={(e) => set('organization_id', e.target.value)}
            >
              <option value="">Select…</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <span className="hint">
              Not listed? <Link href="/admin/organizations">Create the organisation</Link> first.
            </span>
          </div>
          <div className="field">
            <label htmlFor="o-cat">Category</label>
            <select
              id="o-cat"
              className="input"
              value={f.category_slug}
              onChange={(e) => set('category_slug', e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="o-pos">Position (optional)</label>
            <input
              id="o-pos"
              className="input"
              value={f.position_title}
              maxLength={300}
              onChange={(e) => set('position_title', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="o-vac">Vacancies (optional)</label>
            <input
              id="o-vac"
              className="input"
              type="number"
              min="1"
              value={f.vacancies}
              onChange={(e) => set('vacancies', e.target.value)}
            />
          </div>
          <div className={`field${fe.deadline_date ? ' invalid' : ''}`}>
            <label htmlFor="o-dl">Application deadline</label>
            <input
              id="o-dl"
              className="input"
              type="date"
              value={f.deadline_date}
              onChange={(e) => set('deadline_date', e.target.value)}
            />
            <span className="hint">Counted until 23:59 Bangladesh time.</span>
          </div>
          <div className="field">
            <label htmlFor="o-loc">Location</label>
            <select
              id="o-loc"
              className="input"
              value={f.location_slug}
              onChange={(e) => set('location_slug', e.target.value)}
            >
              <option value="">Not specified</option>
              {locations.map((l) => (
                <option key={l.slug} value={l.slug}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Sources and links</h2>
        <div className="form-grid two">
          <div className={`field${fe.official_url ? ' invalid' : ''}`}>
            <label htmlFor="o-off">Official circular link (required to publish)</label>
            <input
              id="o-off"
              className="input"
              type="url"
              placeholder="https://"
              value={f.official_url}
              onChange={(e) => set('official_url', e.target.value)}
            />
            {fe.official_url ? <span className="field-error">{fe.official_url}</span> : null}
          </div>
          <div className={`field${fe.application_url ? ' invalid' : ''}`}>
            <label htmlFor="o-app">Application link (optional)</label>
            <input
              id="o-app"
              className="input"
              type="url"
              placeholder="https://"
              value={f.application_url}
              onChange={(e) => set('application_url', e.target.value)}
            />
            {fe.application_url ? <span className="field-error">{fe.application_url}</span> : null}
          </div>
        </div>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="o-sbn">Summary in Bangla</label>
            <textarea
              id="o-sbn"
              className="input"
              lang="bn"
              maxLength={5000}
              value={f.summary_bn}
              onChange={(e) => set('summary_bn', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="o-sen">Summary in English</label>
            <textarea
              id="o-sen"
              className="input"
              maxLength={5000}
              value={f.summary_en}
              onChange={(e) => set('summary_en', e.target.value)}
            />
          </div>
        </div>
        <div className="form-grid two">
          <div className="field">
            <label htmlFor="o-how">How to apply</label>
            <textarea
              id="o-how"
              className="input"
              maxLength={5000}
              value={f.how_to_apply}
              onChange={(e) => set('how_to_apply', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="o-docs">Documents to prepare (one per line)</label>
            <textarea
              id="o-docs"
              className="input"
              value={f.documents}
              onChange={(e) => set('documents', e.target.value)}
            />
            <span className="hint">
              These become the applicant’s checklist when they track the opportunity.
            </span>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Eligibility requirements</h2>
          <button
            type="button"
            className="btn secondary sm"
            onClick={() => setReqs((p) => [...p, emptyReq()])}
          >
            <Icon name="plus" size="sm" /> Add requirement
          </button>
        </div>
        <p className="muted small">
          These drive the eligibility check. Copy each requirement exactly as the circular states
          it.
        </p>
        {reqs.length === 0 ? <p className="muted">No requirements yet.</p> : null}
        {reqs.map((r, i) => (
          <div key={i} className="req-edit">
            <div className="form-grid two">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`r-type-${i}`}>Type</label>
                <select
                  id={`r-type-${i}`}
                  className="input"
                  value={r.type}
                  onChange={(e) => updateReq(i, { type: e.target.value as ReqType })}
                >
                  <option value="education_level">Minimum education level</option>
                  <option value="age">Age limit</option>
                  <option value="result">Minimum result (CGPA or percent)</option>
                  <option value="experience_years">Years of experience</option>
                  <option value="custom">Other (checked manually)</option>
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`r-nec-${i}`}>Importance</label>
                <select
                  id={`r-nec-${i}`}
                  className="input"
                  value={r.necessity}
                  onChange={(e) => updateReq(i, { necessity: e.target.value as Req['necessity'] })}
                >
                  <option value="mandatory">Required</option>
                  <option value="preferred">Preferred</option>
                </select>
              </div>
              {r.type === 'education_level' ? (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`r-lvl-${i}`}>At least</label>
                  <select
                    id={`r-lvl-${i}`}
                    className="input"
                    value={r.level}
                    onChange={(e) => updateReq(i, { level: e.target.value })}
                  >
                    {LEVELS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              {r.type === 'age' ? (
                <>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`r-min-${i}`}>Minimum age (optional)</label>
                    <input
                      id={`r-min-${i}`}
                      className="input"
                      type="number"
                      min="0"
                      value={r.min}
                      onChange={(e) => updateReq(i, { min: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`r-max-${i}`}>Maximum age</label>
                    <input
                      id={`r-max-${i}`}
                      className="input"
                      type="number"
                      min="0"
                      value={r.max}
                      onChange={(e) => updateReq(i, { max: e.target.value })}
                    />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`r-asof-${i}`}>Age counted on</label>
                    <input
                      id={`r-asof-${i}`}
                      className="input"
                      type="date"
                      value={r.asOf}
                      onChange={(e) => updateReq(i, { asOf: e.target.value })}
                    />
                  </div>
                </>
              ) : null}
              {r.type === 'result' ? (
                <>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`r-sc-${i}`}>Scale</label>
                    <select
                      id={`r-sc-${i}`}
                      className="input"
                      value={r.scale}
                      onChange={(e) => updateReq(i, { scale: e.target.value })}
                    >
                      <option value="gpa4">CGPA out of 4</option>
                      <option value="gpa5">CGPA out of 5</option>
                      <option value="percent">Percent</option>
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`r-rmin-${i}`}>Minimum</label>
                    <input
                      id={`r-rmin-${i}`}
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={r.min}
                      onChange={(e) => updateReq(i, { min: e.target.value })}
                    />
                  </div>
                </>
              ) : null}
              {r.type === 'experience_years' ? (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`r-ex-${i}`}>Minimum years</label>
                  <input
                    id={`r-ex-${i}`}
                    className="input"
                    type="number"
                    step="0.5"
                    min="0"
                    value={r.min}
                    onChange={(e) => updateReq(i, { min: e.target.value })}
                  />
                </div>
              ) : null}
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`r-txt-${i}`}>
                {r.type === 'custom'
                  ? 'Requirement text'
                  : 'Wording shown to applicants (optional, filled in for you)'}
              </label>
              <input
                id={`r-txt-${i}`}
                className="input"
                value={r.text}
                maxLength={2000}
                onChange={(e) => updateReq(i, { text: e.target.value })}
              />
            </div>
            <div>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => setReqs((p) => p.filter((_, j) => j !== i))}
              >
                <Icon name="trash" size="sm" /> Remove
              </button>
              {!reqValid(r) ? (
                <span className="field-error"> Fill in the highlighted values.</span>
              ) : null}
            </div>
          </div>
        ))}
      </section>

      <div className="row-flex">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : mode === 'create' ? 'Create draft' : 'Save changes'}
        </button>
        <Link className="btn ghost" href="/admin/opportunities">
          Back to list
        </Link>
      </div>
    </form>
  );
}
