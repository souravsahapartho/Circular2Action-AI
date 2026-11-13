'use client';

import { useMemo, useState } from 'react';
import {
  evaluate,
  type EducationRecord,
  type EvaluationResult,
  type Level,
  type Profile,
  type Requirement,
  type RuleOutcome,
} from '@c2a/eligibility';
import { StatusBadge } from '@/components/states';
import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { t } from '@/i18n/dictionaries';
import type { ApiRequirement } from '@/lib/api';

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

function RuleRow({ o, labels }: { o: RuleOutcome; labels: L }) {
  const icon = o.result === 'pass' ? '✓' : o.result === 'fail' ? '✕' : '?';
  const cls =
    o.result === 'pass'
      ? 'eligible'
      : o.result === 'fail'
        ? 'not_eligible'
        : 'insufficient_information';
  return (
    <li className="row" style={{ gridTemplateColumns: '1fr', gap: 4 }}>
      <span>{o.sourceText ?? o.ruleType}</span>
      <span>
        <span className={`status ${cls}`}>
          <span aria-hidden="true">{icon}</span>
          {labels[o.result]}
        </span>
        {o.result === 'unknown' ? (
          <span className="muted" style={{ marginLeft: 8 }}>
            {reasonText(o, labels)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function EligibilityCheck({
  requirements,
  labels,
  locale,
}: {
  requirements: ApiRequirement[];
  labels: L;
  locale: Locale;
}) {
  const [dob, setDob] = useState('');
  const [level, setLevel] = useState<Level | ''>('');
  const [gpa, setGpa] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const reqs = useMemo(() => requirements.map(toRequirement), [requirements]);

  const result: EvaluationResult | null = useMemo(() => {
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

  const num = (n: number) => new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-GB').format(n);

  return (
    <div>
      <p>{labels.intro}</p>
      <p className="muted">{labels.privacy}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
        style={{ maxWidth: 420 }}
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

      {result ? (
        <section aria-live="polite" style={{ marginTop: 32 }}>
          <h2>
            <StatusBadge status={result.status} dict={{ eligibility: labels } as Dictionary} />
          </h2>
          <p className="muted tabular">
            {t(labels.summaryLine, {
              pass: num(result.summary.pass),
              fail: num(result.summary.fail),
              unknown: num(result.summary.unknown),
            })}
          </p>
          <h2>{labels.rules}</h2>
          <ul className="rows">
            {result.groups.flatMap((g) =>
              g.branches.flatMap((b) =>
                b.rules.map((o) => <RuleRow key={o.requirementId} o={o} labels={labels} />),
              ),
            )}
          </ul>
          {result.preferred.length > 0 ? (
            <>
              <h2>{labels.preferredTitle}</h2>
              <ul className="rows">
                {result.preferred.map((o) => (
                  <RuleRow key={o.requirementId} o={o} labels={labels} />
                ))}
              </ul>
            </>
          ) : null}
          <p className="muted">{labels.disclaimer}</p>
          <p className="muted">{labels.signInSave}</p>
        </section>
      ) : null}
    </div>
  );
}
