import { ageAt } from '@c2a/dates';
import { evaluateRule, type EvalContext } from './rules';
import {
  ENGINE_VERSION,
  type BranchOutcome,
  type Condition,
  type EligibilityStatus,
  type EvaluationResult,
  type GroupOutcome,
  type Profile,
  type Requirement,
  type RuleOutcome,
  type RuleResult,
  type UnknownReason,
} from './types';

/** Detect contradictory profile data that makes dependent rules undecidable (reason `profile_conflict`). */
export function detectConflicts(p: Profile, asOf: string): EvalContext['conflicts'] {
  const out: EvalContext['conflicts'] = new Set();
  if (p.dateOfBirth !== undefined) {
    const age = ageAt(p.dateOfBirth, asOf);
    if (!age) out.add('dateOfBirth'); // invalid or in the future
  }
  for (const e of p.education ?? []) {
    if (e.startYear !== undefined && e.passingYear !== undefined && e.passingYear < e.startYear)
      out.add('education');
    if (
      e.status === 'completed' &&
      e.passingYear !== undefined &&
      e.passingYear > Number(asOf.slice(0, 4))
    )
      out.add('education');
  }
  const edu = p.education ?? [];
  for (let i = 0; i < edu.length; i++) {
    for (let j = i + 1; j < edu.length; j++) {
      const a = edu[i]!;
      const b = edu[j]!;
      const sameDegree =
        a.level === b.level &&
        a.status === 'completed' &&
        b.status === 'completed' &&
        a.disciplineIds?.length &&
        JSON.stringify(a.disciplineIds) === JSON.stringify(b.disciplineIds);
      if (sameDegree && (a.resultValue !== b.resultValue || a.passingYear !== b.passingYear))
        out.add('education');
    }
  }
  for (const x of p.experience ?? []) {
    if (x.to !== undefined && x.to < x.from) out.add('experience');
  }
  return out;
}

type Tri = RuleResult;

/** Kleene AND over results. */
function and(rs: Tri[]): Tri {
  if (rs.includes('fail')) return 'fail';
  if (rs.includes('unknown')) return 'unknown';
  return 'pass';
}

/** Kleene OR over results. */
function or(rs: Tri[]): Tri {
  if (rs.includes('pass')) return 'pass';
  if (rs.includes('unknown')) return 'unknown';
  return 'fail';
}

function conditionActive(c: Condition, p: Profile): boolean | undefined {
  const v = p[c.field];
  if (v === undefined) return undefined;
  return c.in.includes(v as string | number);
}

function outcomeFor(req: Requirement, p: Profile, ctx: EvalContext): RuleOutcome {
  const base: RuleOutcome = {
    requirementId: req.id,
    ruleType: req.ruleType,
    necessity: req.necessity,
    active: true,
    result: 'unknown',
    ...(req.sourceText !== undefined ? { sourceText: req.sourceText } : {}),
    ...(req.evidence !== undefined ? { evidence: req.evidence } : {}),
  };

  if (req.necessity === 'conditional') {
    if (!req.activationCondition) {
      return {
        ...base,
        result: 'unknown',
        reason: 'unverified_requirement',
        action: { type: 'verify_requirement' },
      };
    }
    const act = conditionActive(req.activationCondition, p);
    if (act === undefined) {
      return {
        ...base,
        result: 'unknown',
        reason: 'missing_profile',
        action: { type: 'add_profile_field', field: req.activationCondition.field },
      };
    }
    if (!act) return { ...base, active: false, result: 'pass' };
  }

  if (!req.verified) {
    return {
      ...base,
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  }
  if (!req.machineEvaluable) {
    return {
      ...base,
      result: 'unknown',
      reason: 'manual_check',
      action: { type: 'check_manually' },
    };
  }
  const r = evaluateRule(req, p, ctx);
  return {
    ...base,
    result: r.result,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.profileValue !== undefined ? { profileValue: r.profileValue } : {}),
    ...(r.action ? { action: r.action } : {}),
  };
}

const REASON_PRIORITY: UnknownReason[] = [
  'profile_conflict',
  'missing_profile',
  'manual_check',
  'unverified_requirement',
];

/**
 * Evaluate eligibility. Deterministic, pure, no model involved (PR-2).
 *
 * Combination: AND within a branch, OR across the branches of a group, AND across mandatory groups.
 * Preferred rules never change the status. Eligible requires at least one evaluated mandatory group.
 */
export function evaluate(
  profile: Profile,
  requirements: Requirement[],
  asOf: string,
): EvaluationResult {
  const ctx: EvalContext = { asOf, conflicts: detectConflicts(profile, asOf) };

  const preferred: RuleOutcome[] = [];
  const grouped = new Map<string, Map<string, RuleOutcome[]>>();
  const sorted = [...requirements].sort((a, b) => a.id.localeCompare(b.id)); // order-independent output

  for (const req of sorted) {
    const o = outcomeFor(req, profile, ctx);
    if (req.necessity === 'preferred') {
      preferred.push(o);
      continue;
    }
    let g = grouped.get(req.groupKey);
    if (!g) grouped.set(req.groupKey, (g = new Map()));
    let b = g.get(req.branchKey);
    if (!b) g.set(req.branchKey, (b = []));
    b.push(o);
  }

  const groups: GroupOutcome[] = [];
  for (const [groupKey, branches] of [...grouped.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const bo: BranchOutcome[] = [];
    for (const [branchKey, rules] of [...branches.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      bo.push({ branchKey, rules, result: and(rules.map((r) => r.result)) });
    }
    groups.push({ groupKey, branches: bo, result: or(bo.map((b) => b.result)) });
  }

  const summary = { pass: 0, fail: 0, unknown: 0 };
  const reasons = new Set<UnknownReason>();
  for (const g of groups) {
    for (const b of g.branches) {
      for (const r of b.rules) {
        if (!r.active) continue;
        summary[r.result] += 1;
      }
    }
    if (g.result === 'unknown') {
      for (const b of g.branches) {
        if (b.result !== 'unknown') continue;
        for (const r of b.rules) if (r.result === 'unknown' && r.reason) reasons.add(r.reason);
      }
    }
  }

  const groupResult = and(groups.map((g) => g.result));
  let status: EligibilityStatus;
  const unknownReasons = REASON_PRIORITY.filter((r) => reasons.has(r));
  if (groups.length === 0) {
    status = 'needs_verification'; // no verified mandatory requirements to evaluate (plan C-03)
  } else if (groupResult === 'fail') {
    status = 'not_eligible';
  } else if (groupResult === 'pass') {
    status = 'eligible';
  } else {
    status =
      reasons.has('missing_profile') || reasons.has('profile_conflict')
        ? 'insufficient_information'
        : 'needs_verification';
  }

  return {
    status,
    groups,
    preferred,
    summary,
    engineVersion: ENGINE_VERSION,
    unknownReasons: status === 'eligible' || status === 'not_eligible' ? [] : unknownReasons,
  };
}
