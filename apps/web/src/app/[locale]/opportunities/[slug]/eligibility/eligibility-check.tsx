'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  evaluate,
  type EducationRecord,
  type EvaluationResult,
  type Level,
  type Profile,
  type Requirement,
  type RuleOutcome,
} from '@c2a/eligibility';
import { Icon, StatusBadge } from '@/components/ui';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { t } from '@/i18n/dictionaries';
import type { ApiRequirement } from '@/lib/api';
import { callApi, errorMessage } from '@/lib/client-api';

const LEVELS: Level[] = ['ssc', 'hsc', 'diploma', 'bachelor', 'masters', 'mphil', 'phd'];

/** yyyy-mm-dd for "today" in Dhaka, the date eligibility is judged on. */
function todayDhaka(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function toRequirement(r: ApiRequirement): Requirement {
  return {
    id: r.id,
    ruleType: r.rule_type as Requirement['ruleType'],
    necessity: r.necessity,
    groupKey: r.group_key,
    branchKey: r.branch_key,
    params: r.params,
    machineEvaluable: r.machine_evaluable,
    verified: r.verified,
    ...(r.text ? { sourceText: r.text } : {}),
  };
}

type L = Dictionary['eligibility'];

function reasonText(o: RuleOutcome, labels: L): string | null {
  const key = o.reason ? (`reason_${o.reason}` as keyof L) : null;
  return key && key in labels ? labels[key] : null;
}

function RuleRow({
  o,
  labels,
  locale,
  signedIn,
}: {
  o: RuleOutcome;
  labels: L;
  locale: Locale;
  signedIn: boolean;
}) {
  const icon = o.result === 'pass' ? '✓' : o.result === 'fail' ? '✕' : '?';
  const cls =
    o.result === 'pass'
      ? 'eligible'
      : o.result === 'fail'
        ? 'not_eligible'
        : 'insufficient_information';
  const needKey = `need_${o.ruleType}` as keyof L;
  const hint =
    o.result !== 'unknown'
      ? null
      : o.reason === 'missing_profile' && needKey in labels
        ? labels[needKey]
        : reasonText(o, labels);
  return (
    <li className="rule-row">
      <span>{o.sourceText ?? o.ruleType}</span>
      <span className="rule-outcome">
        <span className={`status ${cls}`}>
          <span aria-hidden="true">{icon}</span>
          {labels[o.result]}
        </span>
        {hint ? (
          <span className="muted small">
            {hint}{' '}
            {signedIn && o.reason === 'missing_profile' ? (
              <Link href={`/${locale}/app/profile`}>{labels.addToProfile}</Link>
            ) : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function ResultView({
  result,
  labels,
  locale,
  signedIn,
}: {
  result: EvaluationResult;
  labels: L;
  locale: Locale;
  signedIn: boolean;
}) {
  const missing = result.groups
    .flatMap((g) => g.branches.flatMap((b) => b.rules))
    .filter((o) => o.result === 'unknown' && o.reason === 'missing_profile');
  const num = (n: number) => new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB').format(n);
  return (
    <section aria-live="polite" className="card">
      <div className={`verdict ${result.status}`}>
        <StatusBadge status={result.status} label={labels[result.status]} />
        <p>{labels[`verdict_${result.status}` as keyof L]}</p>
        {signedIn &&
        missing.length === 0 &&
        result.status !== 'eligible' &&
        result.status !== 'not_eligible' ? (
          <Link className="btn secondary" href={`/${locale}/app/profile`}>
            {labels.addToProfile}
          </Link>
        ) : null}
      </div>
      {missing.length > 0 ? (
        <div className="missing">
          <h3>{labels.missingTitle}</h3>
          <ul>
            {missing.map((o) => {
              const key = `need_${o.ruleType}` as keyof L;
              return (
                <li key={o.requirementId}>
                  <strong>{key in labels ? labels[key] : labels.reason_missing_profile}</strong>
                  {o.sourceText ? (
                    <span className="muted small">
                      {' '}
                      {t(labels.missingRule, { rule: o.sourceText })}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {signedIn ? (
            <Link className="btn" href={`/${locale}/app/profile`}>
              {labels.addToProfile}
            </Link>
          ) : null}
        </div>
      ) : null}
      <p className="muted tabular">
        {t(labels.summaryLine, {
          pass: num(result.summary.pass),
          fail: num(result.summary.fail),
          unknown: num(result.summary.unknown),
        })}
      </p>
      <h3>{labels.requiredSection}</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {result.groups.flatMap((g) =>
          g.branches.flatMap((b) =>
            b.rules.map((o) => (
              <RuleRow
                key={o.requirementId}
                o={o}
                labels={labels}
                locale={locale}
                signedIn={signedIn}
              />
            )),
          ),
        )}
      </ul>
      {result.preferred.length > 0 ? (
        <>
          <h3 style={{ marginTop: 20 }}>{labels.preferredTitle}</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {result.preferred.map((o) => (
              <RuleRow
                key={o.requirementId}
                o={o}
                labels={labels}
                locale={locale}
                signedIn={signedIn}
              />
            ))}
          </ul>
        </>
      ) : null}
      <p className="muted small" style={{ marginTop: 16 }}>
        {labels.disclaimer}
      </p>
    </section>
  );
}

export function EligibilityCheck({
  opportunityId,
  requirements,
  labels,
  errors,
  locale,
  signedIn,
}: {
  opportunityId: string;
  requirements: ApiRequirement[];
  labels: L;
  errors: Record<string, string>;
  locale: Locale;
  signedIn: boolean;
}) {
  const [dob, setDob] = useState('');
  const [level, setLevel] = useState<Level | ''>('');
  const [gpa, setGpa] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState<EvaluationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqs = useMemo(() => requirements.map(toRequirement), [requirements]);

  const guestResult: EvaluationResult | null = useMemo(() => {
    if (!submitted) return null;
    const education: EducationRecord[] = level
      ? [
          {
            level,
            status: 'completed',
            ...(gpa !== '' && Number.isFinite(Number(gpa))
              ? { resultScale: 'gpa4' as const, resultValue: Number(gpa) }
              : {}),
          },
        ]
      : [];
    const profile: Profile = {
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(level ? { education } : {}),
      experience: [],
    };
    return evaluate(profile, reqs, todayDhaka());
  }, [submitted, dob, level, gpa, reqs]);

  async function runSavedCheck() {
    setBusy(true);
    setError(null);
    const out = await callApi<EvaluationResult>(
      'POST',
      `/api/v1/opportunities/${opportunityId}/eligibility?locale=${locale}`,
    );
    setBusy(false);
    if (out.ok && out.data) setSaved(out.data);
    else setError(errorMessage(errors, out));
  }

  useEffect(() => {
    if (signedIn) void runSavedCheck();
  }, [signedIn, opportunityId]);

  return (
    <div className="stack">
      {signedIn ? (
        <div className="card">
          <p style={{ marginTop: 0 }}>
            {busy && !saved ? labels.loadingProfile : labels.profileIntro}
          </p>
          <div className="row-flex">
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => void runSavedCheck()}
            >
              <Icon name="check" />{' '}
              {busy ? labels.checking : saved ? labels.checkAgain : labels.useProfile}
            </button>
            <Link className="btn secondary" href={`/${locale}/app/profile`}>
              <Icon name="user" /> {labels.editProfile}
            </Link>
          </div>
          {error ? (
            <p className="field-error" role="alert" style={{ marginTop: 12 }}>
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      {saved ? <ResultView result={saved} labels={labels} locale={locale} signedIn /> : null}

      <details className="card" open={!signedIn}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          {signedIn ? labels.tryGuest : labels.guestTitle}
        </summary>
        <p className="muted small" style={{ marginTop: 12 }}>
          {labels.privacy}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(true);
          }}
          style={{ maxWidth: 440 }}
        >
          <div className="field">
            <label htmlFor="dob">{labels.dob}</label>
            <input
              id="dob"
              type="date"
              className="input"
              value={dob}
              max={todayDhaka()}
              onChange={(e) => {
                setDob(e.target.value);
                setSubmitted(false);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="level">{labels.level}</label>
            <select
              id="level"
              className="input"
              value={level}
              onChange={(e) => {
                setLevel(e.target.value as Level | '');
                setSubmitted(false);
              }}
            >
              <option value="">{labels.lvl_none}</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {labels[`lvl_${l}` as keyof L]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="gpa">{labels.gpa4}</label>
            <input
              id="gpa"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              max="4"
              className="input"
              value={gpa}
              onChange={(e) => {
                setGpa(e.target.value);
                setSubmitted(false);
              }}
            />
          </div>
          <button className="btn" type="submit">
            {labels.check}
          </button>
        </form>
      </details>
      {guestResult ? (
        <ResultView result={guestResult} labels={labels} locale={locale} signedIn={signedIn} />
      ) : null}
      {!signedIn ? (
        <p className="muted">
          <Link href={`/${locale}/sign-in`}>{labels.signInSave}</Link>
        </p>
      ) : null}
    </div>
  );
}
