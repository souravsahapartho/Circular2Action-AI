import { ageAt, ageWithin, sumNonOverlappingDays } from '@c2a/dates';
import {
  LEVEL_RANK,
  type EducationRecord,
  type Level,
  type Profile,
  type Requirement,
  type ResultClass,
  type RuleAction,
  type RuleResult,
  type UnknownReason,
} from './types';

export interface RuleEval {
  result: RuleResult;
  reason?: UnknownReason;
  profileValue?: unknown;
  action?: RuleAction;
}

export interface EvalContext {
  /** evaluation date, yyyy-mm-dd (used for experience of current jobs and test validity) */
  asOf: string;
  /** profile data domains with detected conflicts */
  conflicts: Set<'education' | 'dateOfBirth' | 'experience'>;
}

const pass = (profileValue?: unknown): RuleEval => ({ result: 'pass', profileValue });
const fail = (profileValue?: unknown): RuleEval => ({ result: 'fail', profileValue });
const missing = (field: string): RuleEval => ({
  result: 'unknown',
  reason: 'missing_profile',
  action: { type: 'add_profile_field', field },
});
const manual = (): RuleEval => ({
  result: 'unknown',
  reason: 'manual_check',
  action: { type: 'check_manually' },
});
const conflict = (field: string): RuleEval => ({
  result: 'unknown',
  reason: 'profile_conflict',
  action: { type: 'add_profile_field', field },
});

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const arr = <T>(v: unknown): T[] | undefined => (Array.isArray(v) ? (v as T[]) : undefined);
const isLevel = (v: unknown): v is Level => typeof v === 'string' && v in LEVEL_RANK;
const CLASS_RANK: Record<ResultClass, number> = { third: 1, second: 2, first: 3 };

function relevantRecords(edu: EducationRecord[], level: Level | undefined): EducationRecord[] {
  return level ? edu.filter((e) => e.level === level) : edu;
}

function evalAge(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  const asOf = str(req.params['as_of']);
  if (!asOf)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  if (p.dateOfBirth === undefined) return missing('dateOfBirth');
  if (ctx.conflicts.has('dateOfBirth')) return conflict('dateOfBirth');
  const age = ageAt(p.dateOfBirth, asOf);
  if (!age) return conflict('dateOfBirth');
  const min = num(req.params['min']);
  const max = num(req.params['max']);
  if (min !== undefined && age.years < min) return fail(age);
  if (max !== undefined && !ageWithin(age, max)) return fail(age);
  return pass(age);
}

function evalEducationLevel(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.education === undefined) return missing('education');
  if (ctx.conflicts.has('education')) return conflict('education');
  const minLevel = req.params['min_level'];
  if (!isLevel(minLevel))
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const allowAppeared = req.params['allow_appeared'] === true;
  const candidates = p.education.filter((e) => LEVEL_RANK[e.level] >= LEVEL_RANK[minLevel]);
  const ok = candidates.find(
    (e) => e.status === 'completed' || (allowAppeared && e.status === 'appeared'),
  );
  if (ok) return pass({ level: ok.level, status: ok.status });
  return fail(candidates.map((e) => ({ level: e.level, status: e.status })));
}

function evalDiscipline(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.education === undefined) return missing('education');
  if (ctx.conflicts.has('education')) return conflict('education');
  if (req.params['any_discipline'] === true) return pass();
  const wanted = arr<number>(req.params['discipline_ids']);
  if (!wanted || wanted.length === 0)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const levelParam = req.params['level'];
  const recs = relevantRecords(p.education, isLevel(levelParam) ? levelParam : undefined).filter(
    (e) => e.status !== 'in_progress',
  );
  if (recs.length === 0) return missing('education');
  if (recs.some((e) => e.disciplineIds?.some((d) => wanted.includes(d)))) return pass();
  // free-text discipline cannot be matched safely
  if (recs.some((e) => (!e.disciplineIds || e.disciplineIds.length === 0) && e.disciplineOther))
    return manual();
  if (recs.some((e) => !e.disciplineIds || e.disciplineIds.length === 0))
    return missing('education.discipline');
  return fail(recs.map((e) => e.disciplineIds));
}

function evalResult(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.education === undefined) return missing('education');
  if (ctx.conflicts.has('education')) return conflict('education');
  const levelParam = req.params['level'];
  const recs = relevantRecords(p.education, isLevel(levelParam) ? levelParam : undefined).filter(
    (e) => e.status === 'completed',
  );
  const rec = recs.sort((a, b) => (b.passingYear ?? 0) - (a.passingYear ?? 0))[0];
  if (!rec) return missing('education.result');
  const minClass = str(req.params['min_class']) as ResultClass | undefined;
  if (minClass) {
    if (!rec.resultClass)
      return rec.resultScale && rec.resultScale !== 'class'
        ? manual()
        : missing('education.result');
    return CLASS_RANK[rec.resultClass] >= CLASS_RANK[minClass]
      ? pass(rec.resultClass)
      : fail(rec.resultClass);
  }
  const scale = str(req.params['scale']);
  const min = num(req.params['min']);
  if (!scale || min === undefined)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  if (rec.resultValue === undefined || !rec.resultScale) return missing('education.result');
  // No cross-scale approximation: a missing mapping is "unknown", never a guess (plan C-04).
  if (rec.resultScale !== scale) return manual();
  return rec.resultValue >= min ? pass(rec.resultValue) : fail(rec.resultValue);
}

function evalExperience(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.experience === undefined) return missing('experience');
  if (ctx.conflicts.has('experience')) return conflict('experience');
  const min = num(req.params['min']);
  if (min === undefined)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const kinds = arr<string>(req.params['kinds']);
  const field = str(req.params['field']);
  const entries = p.experience.filter(
    (e) => (!kinds || kinds.includes(e.kind)) && (!field || e.field === field),
  );
  if (field && p.experience.some((e) => !e.field)) {
    // entries without a field cannot be matched to a required field of experience
    const unmatched = p.experience.filter((e) => !e.field && (!kinds || kinds.includes(e.kind)));
    if (unmatched.length > 0 && entries.length === 0) return manual();
  }
  const days = sumNonOverlappingDays(entries.map((e) => ({ from: e.from, to: e.to ?? ctx.asOf })));
  const needed = Math.round(min * 365.25);
  return days >= needed ? pass({ days }) : fail({ days });
}

function evalSkill(req: Requirement, p: Profile): RuleEval {
  if (p.skillIds === undefined) return missing('skills');
  const ids = arr<number>(req.params['skill_ids']);
  if (!ids || ids.length === 0)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const mode = req.params['mode'] === 'any' ? 'any' : 'all';
  const have = ids.filter((i) => p.skillIds!.includes(i));
  const ok = mode === 'any' ? have.length > 0 : have.length === ids.length;
  return ok ? pass(have) : fail(have);
}

function evalNationality(req: Requirement, p: Profile): RuleEval {
  if (p.nationality === undefined) return missing('nationality');
  const allowed = arr<string>(req.params['allowed']);
  const excluded = arr<string>(req.params['excluded']);
  if (excluded?.includes(p.nationality)) return fail(p.nationality);
  if (allowed && !allowed.includes(p.nationality)) return fail(p.nationality);
  if (!allowed && !excluded)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  return pass(p.nationality);
}

function evalDistrict(req: Requirement, p: Profile): RuleEval {
  const ids = arr<number>(req.params['district_ids']);
  if (!ids || ids.length === 0)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const which = str(req.params['which']) ?? 'home';
  const home = p.homeDistrictId;
  const cur = p.currentDistrictId;
  const vals = which === 'current' ? [cur] : which === 'either' ? [home, cur] : [home];
  const present = vals.filter((v): v is number => v !== undefined);
  if (present.length === 0)
    return missing(which === 'current' ? 'currentDistrictId' : 'homeDistrictId');
  return present.some((v) => ids.includes(v)) ? pass(present) : fail(present);
}

function evalGender(req: Requirement, p: Profile): RuleEval {
  if (p.gender === undefined) return missing('gender');
  const allowed = arr<string>(req.params['allowed']);
  if (!allowed || allowed.length === 0)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  return allowed.includes(p.gender) ? pass(p.gender) : fail(p.gender);
}

function evalLanguageTest(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.languageTests === undefined) return missing('languageTests');
  const test = str(req.params['test']);
  const min = num(req.params['min']);
  if (!test || min === undefined)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const taken = p.languageTests.filter((t) => t.test === test);
  // A waiver may apply; an absent test is not a failure we can assert (plan: never mislead).
  if (taken.length === 0) return missing('languageTests');
  const validMonths = num(req.params['valid_months']);
  const valid = taken.filter((t) => {
    if (validMonths === undefined) return true;
    if (!t.takenOn) return false;
    const d = new Date(`${t.takenOn}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + validMonths);
    return d.toISOString().slice(0, 10) >= ctx.asOf;
  });
  if (valid.length === 0)
    return taken.some((t) => !t.takenOn) ? missing('languageTests.takenOn') : fail(taken);
  return valid.some((t) => t.overall >= min) ? pass(valid) : fail(valid);
}

function evalPassingYear(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  if (p.education === undefined) return missing('education');
  if (ctx.conflicts.has('education')) return conflict('education');
  const levelParam = req.params['level'];
  const recs = relevantRecords(p.education, isLevel(levelParam) ? levelParam : undefined).filter(
    (e) => e.passingYear !== undefined,
  );
  if (recs.length === 0) return missing('education.passingYear');
  const min = num(req.params['min']);
  const max = num(req.params['max']);
  if (min === undefined && max === undefined)
    return {
      result: 'unknown',
      reason: 'unverified_requirement',
      action: { type: 'verify_requirement' },
    };
  const ok = recs.some(
    (e) =>
      (min === undefined || e.passingYear! >= min) && (max === undefined || e.passingYear! <= max),
  );
  return ok ? pass(recs.map((e) => e.passingYear)) : fail(recs.map((e) => e.passingYear));
}

/** Evaluate one verified, machine-evaluable, active rule. */
export function evaluateRule(req: Requirement, p: Profile, ctx: EvalContext): RuleEval {
  switch (req.ruleType) {
    case 'age':
      return evalAge(req, p, ctx);
    case 'education_level':
      return evalEducationLevel(req, p, ctx);
    case 'discipline':
      return evalDiscipline(req, p, ctx);
    case 'result':
      return evalResult(req, p, ctx);
    case 'experience_years':
      return evalExperience(req, p, ctx);
    case 'skill':
      return evalSkill(req, p);
    case 'nationality':
      return evalNationality(req, p);
    case 'district':
      return evalDistrict(req, p);
    case 'gender':
      return evalGender(req, p);
    case 'language_test':
      return evalLanguageTest(req, p, ctx);
    case 'passing_year':
      return evalPassingYear(req, p, ctx);
    case 'custom':
      return manual();
  }
}
