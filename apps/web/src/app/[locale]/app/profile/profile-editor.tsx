'use client';

import { useState } from 'react';
import { Alert, Icon } from '@/components/ui';
import type { Dictionary } from '@/i18n/dictionaries';
import { callApi, errorMessage, fieldErrors } from '@/lib/client-api';

export interface EducationData {
  id: string;
  level: string;
  institution_other: string | null;
  discipline_other: string | null;
  degree_title: string | null;
  result_scale: string | null;
  result_value: number | null;
  result_class: string | null;
  status: string;
  start_year: number | null;
  passing_year: number | null;
}
export interface ProfileData {
  profile: {
    date_of_birth: string | null;
    gender: 'female' | 'male' | 'other' | null;
    nationality_country: string;
    home_district_id: string | null;
    headline: string | null;
  };
  education: EducationData[];
  completeness: number;
}
type L = Dictionary['profile'];
const LEVELS = ['ssc', 'hsc', 'diploma', 'bachelor', 'masters', 'mphil', 'phd'] as const;
const LEVEL_KEY: Record<string, string> = {
  ssc: 'lvl_ssc',
  hsc: 'lvl_hsc',
  diploma: 'lvl_diploma',
  bachelor: 'lvl_bachelor',
  masters: 'lvl_masters',
  mphil: 'lvl_mphil',
  phd: 'lvl_phd',
};

const blank = {
  level: 'bachelor',
  institution_other: '',
  discipline_other: '',
  degree_title: '',
  result_scale: 'gpa4',
  result_value: '',
  result_class: '',
  status: 'completed',
  start_year: '',
  passing_year: '',
};
type EduForm = typeof blank;

function EducationForm({
  initial,
  labels,
  errors,
  levelLabels,
  onSaved,
  onCancel,
  editId,
}: {
  initial: EduForm;
  labels: L;
  errors: Record<string, string>;
  levelLabels: Record<string, string>;
  onSaved: () => void;
  onCancel: () => void;
  editId: string | null;
}) {
  const [f, setF] = useState<EduForm>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof EduForm, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const body = {
      level: f.level,
      institution_other: f.institution_other.trim() || null,
      discipline_other: f.discipline_other.trim() || null,
      degree_title: f.degree_title.trim() || null,
      result_scale:
        f.result_scale === 'class' ? 'class' : f.result_value.trim() === '' ? null : f.result_scale,
      result_value: f.result_scale === 'class' ? null : num(f.result_value),
      result_class: f.result_scale === 'class' ? f.result_class || null : null,
      status: f.status,
      start_year: num(f.start_year),
      passing_year: num(f.passing_year),
    };
    const out = editId
      ? await callApi('PATCH', `/api/v1/me/education/${editId}`, body)
      : await callApi('POST', '/api/v1/me/education', body);
    setBusy(false);
    if (out.ok) onSaved();
    else {
      setFe(fieldErrors(out));
      setError(errorMessage(errors, out));
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="card" style={{ marginTop: 12 }} noValidate>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <div className="form-grid two">
        <div className="field">
          <label htmlFor="e-level">{labels.level}</label>
          <select
            id="e-level"
            className="input"
            value={f.level}
            onChange={(e) => set('level', e.target.value)}
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {levelLabels[LEVEL_KEY[l]!]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-status">{labels.status}</label>
          <select
            id="e-status"
            className="input"
            value={f.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="completed">{labels.completed}</option>
            <option value="in_progress">{labels.in_progress}</option>
            <option value="appeared">{labels.appeared}</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="e-inst">{labels.institution}</label>
          <input
            id="e-inst"
            className="input"
            value={f.institution_other}
            maxLength={200}
            onChange={(e) => set('institution_other', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="e-disc">{labels.discipline}</label>
          <input
            id="e-disc"
            className="input"
            value={f.discipline_other}
            maxLength={200}
            onChange={(e) => set('discipline_other', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="e-scale">{labels.scale}</label>
          <select
            id="e-scale"
            className="input"
            value={f.result_scale}
            onChange={(e) => set('result_scale', e.target.value)}
          >
            <option value="gpa4">{labels.gpa4}</option>
            <option value="gpa5">{labels.gpa5}</option>
            <option value="percent">{labels.percent}</option>
            <option value="class">{labels.class}</option>
          </select>
        </div>
        {f.result_scale === 'class' ? (
          <div className="field">
            <label htmlFor="e-class">{labels.class}</label>
            <select
              id="e-class"
              className="input"
              value={f.result_class}
              onChange={(e) => set('result_class', e.target.value)}
            >
              <option value="" />
              <option value="first">{labels.first}</option>
              <option value="second">{labels.second}</option>
              <option value="third">{labels.third}</option>
            </select>
          </div>
        ) : (
          <div className={`field${fe.result_value ? ' invalid' : ''}`}>
            <label htmlFor="e-val">{labels.result}</label>
            <input
              id="e-val"
              className="input"
              type="number"
              step="0.01"
              min="0"
              max={f.result_scale === 'percent' ? 100 : f.result_scale === 'gpa5' ? 5 : 4}
              value={f.result_value}
              onChange={(e) => set('result_value', e.target.value)}
            />
            {fe.result_value ? <span className="field-error">{fe.result_value}</span> : null}
          </div>
        )}
        <div className="field">
          <label htmlFor="e-sy">{labels.startYear}</label>
          <input
            id="e-sy"
            className="input"
            type="number"
            min="1950"
            max="2100"
            value={f.start_year}
            onChange={(e) => set('start_year', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="e-py">{labels.passingYear}</label>
          <input
            id="e-py"
            className="input"
            type="number"
            min="1950"
            max="2100"
            value={f.passing_year}
            onChange={(e) => set('passing_year', e.target.value)}
          />
        </div>
      </div>
      <div className="row-flex">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? '…' : labels.save}
        </button>
        <button className="btn ghost" type="button" onClick={onCancel}>
          ✕
        </button>
      </div>
    </form>
  );
}

export function ProfileEditor({
  initial,
  locations,
  labels,
  errors,
  common,
  completenessLabel,
  levelLabels,
}: {
  initial: ProfileData;
  locations: Array<{ id: string; name: string }>;
  labels: L & Record<string, string>;
  errors: Record<string, string>;
  common: Dictionary['common'];
  completenessLabel: string;
  levelLabels: Record<string, string>;
}) {
  const [p, setP] = useState(initial.profile);
  const [edu, setEdu] = useState(initial.education);
  const [completeness, setCompleteness] = useState(initial.completeness);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ id: string | null; data: EduForm } | null>(null);

  async function refresh() {
    const out = await callApi<ProfileData>('GET', '/api/v1/me/profile');
    if (out.ok && out.data) {
      setEdu(out.data.education);
      setCompleteness(out.data.completeness);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setError(null);
    setFe({});
    const out = await callApi('PUT', '/api/v1/me/profile', {
      date_of_birth: p.date_of_birth || null,
      gender: p.gender || null,
      home_district_id: p.home_district_id || null,
      headline: p.headline?.trim() || null,
    });
    setBusy(false);
    if (out.ok) {
      setMsg(labels.saved);
      void refresh();
    } else {
      setFe(fieldErrors(out));
      setError(errorMessage(errors, out));
    }
  }

  const toForm = (e: EducationData): EduForm => ({
    level: e.level,
    institution_other: e.institution_other ?? '',
    discipline_other: e.discipline_other ?? '',
    degree_title: e.degree_title ?? '',
    result_scale: e.result_scale ?? 'gpa4',
    result_value: e.result_value === null ? '' : String(e.result_value),
    result_class: e.result_class ?? '',
    status: e.status,
    start_year: e.start_year === null ? '' : String(e.start_year),
    passing_year: e.passing_year === null ? '' : String(e.passing_year),
  });

  return (
    <div className="stack">
      <div className="card">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <strong>{completenessLabel}</strong>
          <span className="tabular">{completeness}%</span>
        </div>
        <div
          className="progress"
          style={{ marginTop: 8 }}
          role="progressbar"
          aria-valuenow={completeness}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${completeness}%` }} />
        </div>
      </div>

      <form className="card" onSubmit={(e) => void save(e)} noValidate>
        <h2>{labels.basics}</h2>
        {msg ? <Alert kind="success">{msg}</Alert> : null}
        {error ? <Alert kind="error">{error}</Alert> : null}
        <div className="form-grid two">
          <div className={`field${fe.date_of_birth ? ' invalid' : ''}`}>
            <label htmlFor="p-dob">{labels.dob}</label>
            <input
              id="p-dob"
              type="date"
              className="input"
              value={p.date_of_birth ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setP({ ...p, date_of_birth: e.target.value || null })}
            />
            {fe.date_of_birth ? <span className="field-error">{fe.date_of_birth}</span> : null}
          </div>
          <div className="field">
            <label htmlFor="p-gender">{labels.gender}</label>
            <select
              id="p-gender"
              className="input"
              value={p.gender ?? ''}
              onChange={(e) => setP({ ...p, gender: (e.target.value || null) as typeof p.gender })}
            >
              <option value="">{labels.notSay}</option>
              <option value="female">{labels.female}</option>
              <option value="male">{labels.male}</option>
              <option value="other">{labels.other}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-home">{labels.home}</label>
            <select
              id="p-home"
              className="input"
              value={p.home_district_id ?? ''}
              onChange={(e) => setP({ ...p, home_district_id: e.target.value || null })}
            >
              <option value="">{common.select}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="p-head">{labels.headline}</label>
            <input
              id="p-head"
              className="input"
              value={p.headline ?? ''}
              maxLength={160}
              onChange={(e) => setP({ ...p, headline: e.target.value })}
            />
            <span className="hint">{labels.headlineHint}</span>
          </div>
        </div>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? common.saving : labels.save}
        </button>
      </form>

      <section className="card">
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{labels.education}</h2>
          <button
            className="btn secondary sm"
            type="button"
            onClick={() => setForm({ id: null, data: blank })}
          >
            <Icon name="plus" size="sm" /> {labels.addEducation}
          </button>
        </div>
        {edu.length === 0 && !form ? (
          <p className="muted" style={{ marginTop: 12 }}>
            {labels.emptyEducation}
          </p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0' }}>
          {edu.map((e) => (
            <li
              key={e.id}
              className="rule-row"
              style={{ gridTemplateColumns: '1fr auto', alignItems: 'center' }}
            >
              <div>
                <strong>{levelLabels[LEVEL_KEY[e.level] ?? ''] ?? e.level}</strong>
                {e.discipline_other ? ` · ${e.discipline_other}` : ''}
                {e.institution_other ? (
                  <div className="muted small">{e.institution_other}</div>
                ) : null}
                <div className="muted small tabular">
                  {e.result_value !== null ? `${e.result_value} ` : ''}
                  {e.passing_year ?? ''}
                </div>
              </div>
              <div className="row-flex">
                <button
                  className="btn ghost sm"
                  type="button"
                  aria-label={common.edit}
                  onClick={() => setForm({ id: e.id, data: toForm(e) })}
                >
                  <Icon name="edit" size="sm" />
                </button>
                <button
                  className="btn ghost sm"
                  type="button"
                  aria-label={common.remove}
                  onClick={async () => {
                    if (!window.confirm(labels.confirmRemove)) return;
                    const out = await callApi('DELETE', `/api/v1/me/education/${e.id}`);
                    if (out.ok) void refresh();
                  }}
                >
                  <Icon name="trash" size="sm" />
                </button>
              </div>
            </li>
          ))}
        </ul>
        {form ? (
          <EducationForm
            key={form.id ?? 'new'}
            initial={form.data}
            editId={form.id}
            labels={labels}
            errors={errors}
            levelLabels={levelLabels}
            onSaved={() => {
              setForm(null);
              void refresh();
            }}
            onCancel={() => setForm(null)}
          />
        ) : null}
      </section>
    </div>
  );
}
