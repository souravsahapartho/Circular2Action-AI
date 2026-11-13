import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate, type EligibilityStatus, type Profile, type Requirement } from '../src/index';
import { AS_OF, baseProfile, bachelorCse, req } from './helpers';

interface Case {
  name: string;
  profile: Profile;
  reqs: Requirement[];
  expected: EligibilityStatus;
  reasons?: string[];
}

const age = (max: number, asOf = '2026-11-01') =>
  req({ ruleType: 'age', params: { max, as_of: asOf } });
const level = (min_level: string, extra: object = {}) =>
  req({ ruleType: 'education_level', params: { min_level, ...extra } });

const cases: Case[] = [
  // ---- age ----
  {
    name: 'age: exactly at the limit on the reference date passes',
    profile: baseProfile({ dateOfBirth: '1994-11-01' }),
    reqs: [age(32)],
    expected: 'eligible',
  },
  {
    name: 'age: one day over the limit fails',
    profile: baseProfile({ dateOfBirth: '1994-10-31' }),
    reqs: [age(32)],
    expected: 'not_eligible',
  },
  {
    name: 'age: below minimum fails',
    profile: baseProfile({ dateOfBirth: '2010-01-01' }),
    reqs: [req({ ruleType: 'age', params: { min: 18, max: 32, as_of: '2026-11-01' } })],
    expected: 'not_eligible',
  },
  {
    name: 'age: missing date of birth is insufficient information',
    profile: baseProfile({ dateOfBirth: undefined }),
    reqs: [age(32)],
    expected: 'insufficient_information',
    reasons: ['missing_profile'],
  },
  {
    name: 'age: missing reference date means unverified requirement, not today',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'age', params: { max: 32 } })],
    expected: 'needs_verification',
    reasons: ['unverified_requirement'],
  },
  {
    name: 'age: future date of birth is a profile conflict',
    profile: baseProfile({ dateOfBirth: '2031-01-01' }),
    reqs: [age(32)],
    expected: 'insufficient_information',
    reasons: ['profile_conflict'],
  },
  {
    name: 'age: invalid date of birth is a profile conflict',
    profile: baseProfile({ dateOfBirth: '1999-02-31' }),
    reqs: [age(32)],
    expected: 'insufficient_information',
    reasons: ['profile_conflict'],
  },
  {
    name: 'age: reference date in the past is respected',
    profile: baseProfile({ dateOfBirth: '1991-01-01' }),
    reqs: [age(32, '2022-06-01')],
    expected: 'eligible',
  },
  // ---- education level ----
  {
    name: 'level: masters satisfies bachelor-or-above',
    profile: baseProfile({ education: [{ ...bachelorCse, level: 'masters' }] }),
    reqs: [level('bachelor')],
    expected: 'eligible',
  },
  {
    name: 'level: bachelor does not satisfy masters',
    profile: baseProfile(),
    reqs: [level('masters')],
    expected: 'not_eligible',
  },
  {
    name: 'level: in-progress degree fails when completed is required',
    profile: baseProfile({
      education: [{ ...bachelorCse, status: 'in_progress', passingYear: undefined }],
    }),
    reqs: [level('bachelor')],
    expected: 'not_eligible',
  },
  {
    name: 'level: appeared candidates pass when the circular allows them',
    profile: baseProfile({
      education: [{ ...bachelorCse, status: 'appeared', passingYear: undefined }],
    }),
    reqs: [level('bachelor', { allow_appeared: true })],
    expected: 'eligible',
  },
  {
    name: 'level: no education provided is insufficient information',
    profile: baseProfile({ education: undefined }),
    reqs: [level('bachelor')],
    expected: 'insufficient_information',
  },
  {
    name: 'level: explicitly empty education fails',
    profile: baseProfile({ education: [] }),
    reqs: [level('bachelor')],
    expected: 'not_eligible',
  },
  {
    name: 'level: unknown level parameter is an unverified requirement',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'education_level', params: { min_level: 'wizard' } })],
    expected: 'needs_verification',
  },
  // ---- discipline ----
  {
    name: 'discipline: matching id passes',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'discipline', params: { discipline_ids: [12, 44] } })],
    expected: 'eligible',
  },
  {
    name: 'discipline: non-matching id fails',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'discipline', params: { discipline_ids: [99] } })],
    expected: 'not_eligible',
  },
  {
    name: 'discipline: any discipline passes without education details',
    profile: baseProfile({ education: [] }),
    reqs: [req({ ruleType: 'discipline', params: { any_discipline: true } })],
    expected: 'eligible',
  },
  {
    name: 'discipline: free-text discipline needs manual check',
    profile: baseProfile({
      education: [{ ...bachelorCse, disciplineIds: undefined, disciplineOther: 'Computing' }],
    }),
    reqs: [req({ ruleType: 'discipline', params: { discipline_ids: [12] } })],
    expected: 'needs_verification',
    reasons: ['manual_check'],
  },
  {
    name: 'discipline: no discipline given is insufficient information',
    profile: baseProfile({ education: [{ ...bachelorCse, disciplineIds: undefined }] }),
    reqs: [req({ ruleType: 'discipline', params: { discipline_ids: [12] } })],
    expected: 'insufficient_information',
  },
  // ---- results ----
  {
    name: 'result: equal to minimum on same scale passes',
    profile: baseProfile({ education: [{ ...bachelorCse, resultValue: 3.0 }] }),
    reqs: [req({ ruleType: 'result', params: { scale: 'gpa4', min: 3.0, level: 'bachelor' } })],
    expected: 'eligible',
  },
  {
    name: 'result: just below minimum fails',
    profile: baseProfile({ education: [{ ...bachelorCse, resultValue: 2.99 }] }),
    reqs: [req({ ruleType: 'result', params: { scale: 'gpa4', min: 3.0, level: 'bachelor' } })],
    expected: 'not_eligible',
  },
  {
    name: 'result: different scale is never approximated',
    profile: baseProfile({
      education: [{ ...bachelorCse, resultScale: 'gpa5', resultValue: 4.5 }],
    }),
    reqs: [req({ ruleType: 'result', params: { scale: 'gpa4', min: 3.0, level: 'bachelor' } })],
    expected: 'needs_verification',
    reasons: ['manual_check'],
  },
  {
    name: 'result: class requirement met',
    profile: baseProfile({
      education: [
        { ...bachelorCse, resultScale: 'class', resultValue: undefined, resultClass: 'first' },
      ],
    }),
    reqs: [req({ ruleType: 'result', params: { min_class: 'second', level: 'bachelor' } })],
    expected: 'eligible',
  },
  {
    name: 'result: class requirement not met',
    profile: baseProfile({
      education: [
        { ...bachelorCse, resultScale: 'class', resultValue: undefined, resultClass: 'third' },
      ],
    }),
    reqs: [req({ ruleType: 'result', params: { min_class: 'second', level: 'bachelor' } })],
    expected: 'not_eligible',
  },
  {
    name: 'result: missing result value is insufficient information',
    profile: baseProfile({ education: [{ ...bachelorCse, resultValue: undefined }] }),
    reqs: [req({ ruleType: 'result', params: { scale: 'gpa4', min: 3.0, level: 'bachelor' } })],
    expected: 'insufficient_information',
  },
  // ---- experience ----
  {
    name: 'experience: enough years passes',
    profile: baseProfile({ experience: [{ kind: 'job', from: '2020-01-01', to: '2023-01-01' }] }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 2 } })],
    expected: 'eligible',
  },
  {
    name: 'experience: too short fails',
    profile: baseProfile({ experience: [{ kind: 'job', from: '2025-01-01', to: '2025-06-01' }] }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 2 } })],
    expected: 'not_eligible',
  },
  {
    name: 'experience: overlapping jobs are counted once',
    profile: baseProfile({
      experience: [
        { kind: 'job', from: '2024-01-01', to: '2024-12-31' },
        { kind: 'job', from: '2024-01-01', to: '2024-12-31' },
      ],
    }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 2 } })],
    expected: 'not_eligible',
  },
  {
    name: 'experience: current job runs to the reference date',
    profile: baseProfile({ experience: [{ kind: 'job', from: '2023-01-01' }] }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 3 } })],
    expected: 'eligible',
  },
  {
    name: 'experience: not provided is insufficient information',
    profile: baseProfile({ experience: undefined }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 1 } })],
    expected: 'insufficient_information',
  },
  {
    name: 'experience: inverted range is a profile conflict',
    profile: baseProfile({ experience: [{ kind: 'job', from: '2024-05-01', to: '2024-01-01' }] }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 1 } })],
    expected: 'insufficient_information',
    reasons: ['profile_conflict'],
  },
  {
    name: 'experience: internships can be excluded by kind',
    profile: baseProfile({
      experience: [{ kind: 'internship', from: '2020-01-01', to: '2024-01-01' }],
    }),
    reqs: [req({ ruleType: 'experience_years', params: { min: 2, kinds: ['job'] } })],
    expected: 'not_eligible',
  },
  // ---- other rule types ----
  {
    name: 'skill: all required skills present',
    profile: baseProfile({ skillIds: [1, 2, 3] }),
    reqs: [req({ ruleType: 'skill', params: { skill_ids: [1, 2], mode: 'all' } })],
    expected: 'eligible',
  },
  {
    name: 'skill: missing one of all fails',
    profile: baseProfile({ skillIds: [1] }),
    reqs: [req({ ruleType: 'skill', params: { skill_ids: [1, 2], mode: 'all' } })],
    expected: 'not_eligible',
  },
  {
    name: 'skill: any mode passes with one',
    profile: baseProfile({ skillIds: [2] }),
    reqs: [req({ ruleType: 'skill', params: { skill_ids: [1, 2], mode: 'any' } })],
    expected: 'eligible',
  },
  {
    name: 'nationality: allowed passes',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'nationality', params: { allowed: ['BD'] } })],
    expected: 'eligible',
  },
  {
    name: 'nationality: not allowed fails',
    profile: baseProfile({ nationality: 'IN' }),
    reqs: [req({ ruleType: 'nationality', params: { allowed: ['BD'] } })],
    expected: 'not_eligible',
  },
  {
    name: 'nationality: excluded fails',
    profile: baseProfile({ nationality: 'IN' }),
    reqs: [req({ ruleType: 'nationality', params: { excluded: ['IN'] } })],
    expected: 'not_eligible',
  },
  {
    name: 'district: home district in list passes',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'district', params: { district_ids: [301, 302], which: 'home' } })],
    expected: 'eligible',
  },
  {
    name: 'district: not in list fails',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'district', params: { district_ids: [305], which: 'home' } })],
    expected: 'not_eligible',
  },
  {
    name: 'district: missing home district is insufficient information',
    profile: baseProfile({ homeDistrictId: undefined }),
    reqs: [req({ ruleType: 'district', params: { district_ids: [301], which: 'home' } })],
    expected: 'insufficient_information',
  },
  {
    name: 'gender: allowed passes',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'gender', params: { allowed: ['female'] } })],
    expected: 'eligible',
  },
  {
    name: 'gender: not provided is insufficient information',
    profile: baseProfile({ gender: undefined }),
    reqs: [req({ ruleType: 'gender', params: { allowed: ['female'] } })],
    expected: 'insufficient_information',
  },
  {
    name: 'language test: score met and valid on the date',
    profile: baseProfile({ languageTests: [{ test: 'ielts', overall: 7, takenOn: '2025-06-01' }] }),
    reqs: [
      req({ ruleType: 'language_test', params: { test: 'ielts', min: 6.5, valid_months: 24 } }),
    ],
    expected: 'eligible',
  },
  {
    name: 'language test: expired score fails',
    profile: baseProfile({ languageTests: [{ test: 'ielts', overall: 7, takenOn: '2022-01-01' }] }),
    reqs: [
      req({ ruleType: 'language_test', params: { test: 'ielts', min: 6.5, valid_months: 24 } }),
    ],
    expected: 'not_eligible',
  },
  {
    name: 'language test: score too low fails',
    profile: baseProfile({
      languageTests: [{ test: 'ielts', overall: 5.5, takenOn: '2026-01-01' }],
    }),
    reqs: [req({ ruleType: 'language_test', params: { test: 'ielts', min: 6.5 } })],
    expected: 'not_eligible',
  },
  {
    name: 'language test: not taken is not asserted as a failure (waivers exist)',
    profile: baseProfile({ languageTests: [] }),
    reqs: [req({ ruleType: 'language_test', params: { test: 'ielts', min: 6.5 } })],
    expected: 'insufficient_information',
  },
  {
    name: 'passing year: within range passes',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'passing_year', params: { min: 2020, max: 2026, level: 'bachelor' } })],
    expected: 'eligible',
  },
  {
    name: 'passing year: outside range fails',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'passing_year', params: { min: 2024, level: 'bachelor' } })],
    expected: 'not_eligible',
  },
  {
    name: 'passing year before start year is a profile conflict',
    profile: baseProfile({ education: [{ ...bachelorCse, startYear: 2022, passingYear: 2018 }] }),
    reqs: [req({ ruleType: 'passing_year', params: { min: 2015, level: 'bachelor' } })],
    expected: 'insufficient_information',
    reasons: ['profile_conflict'],
  },
  // ---- logic: groups, branches, necessity ----
  {
    name: 'logic: alternatives across branches (OR) pass when one branch passes',
    profile: baseProfile(),
    reqs: [
      req({
        ruleType: 'education_level',
        params: { min_level: 'masters' },
        groupKey: 'edu',
        branchKey: 'a',
      }),
      req({
        ruleType: 'education_level',
        params: { min_level: 'bachelor' },
        groupKey: 'edu',
        branchKey: 'b',
      }),
    ],
    expected: 'eligible',
  },
  {
    name: 'logic: all branches failing fails the group',
    profile: baseProfile(),
    reqs: [
      req({
        ruleType: 'education_level',
        params: { min_level: 'masters' },
        groupKey: 'edu',
        branchKey: 'a',
      }),
      req({
        ruleType: 'education_level',
        params: { min_level: 'phd' },
        groupKey: 'edu',
        branchKey: 'b',
      }),
    ],
    expected: 'not_eligible',
  },
  {
    name: 'logic: AND inside a branch fails on one failing rule',
    profile: baseProfile(),
    reqs: [level('bachelor'), age(20)],
    expected: 'not_eligible',
  },
  {
    name: 'logic: AND across groups needs every group',
    profile: baseProfile(),
    reqs: [
      req({ ruleType: 'age', params: { max: 40, as_of: AS_OF }, groupKey: 'g1' }),
      req({ ruleType: 'nationality', params: { allowed: ['IN'] }, groupKey: 'g2' }),
    ],
    expected: 'not_eligible',
  },
  {
    name: 'logic: a failing branch with an unknown alternative stays unknown',
    profile: baseProfile({ gender: undefined }),
    reqs: [
      req({
        ruleType: 'education_level',
        params: { min_level: 'masters' },
        groupKey: 'g',
        branchKey: 'a',
      }),
      req({ ruleType: 'gender', params: { allowed: ['female'] }, groupKey: 'g', branchKey: 'b' }),
    ],
    expected: 'insufficient_information',
  },
  {
    name: 'logic: any fail dominates unknowns across groups',
    profile: baseProfile({ gender: undefined }),
    reqs: [
      req({ ruleType: 'gender', params: { allowed: ['female'] }, groupKey: 'g1' }),
      req({ ruleType: 'nationality', params: { allowed: ['IN'] }, groupKey: 'g2' }),
    ],
    expected: 'not_eligible',
  },
  {
    name: 'necessity: preferred rules never change the status',
    profile: baseProfile({ skillIds: [] }),
    reqs: [
      level('bachelor'),
      req({
        ruleType: 'skill',
        params: { skill_ids: [9], mode: 'all' },
        necessity: 'preferred',
        groupKey: 'p',
      }),
    ],
    expected: 'eligible',
  },
  {
    name: 'necessity: conditional rule inactive has no effect',
    profile: baseProfile({ gender: 'male' }),
    reqs: [
      level('bachelor'),
      req({
        ruleType: 'age',
        params: { max: 40, as_of: AS_OF },
        necessity: 'conditional',
        activationCondition: { field: 'gender', in: ['female'] },
        groupKey: 'q',
      }),
    ],
    expected: 'eligible',
  },
  {
    name: 'necessity: conditional rule active is enforced',
    profile: baseProfile({ gender: 'female', dateOfBirth: '1980-01-01' }),
    reqs: [
      level('bachelor'),
      req({
        ruleType: 'age',
        params: { max: 40, as_of: AS_OF },
        necessity: 'conditional',
        activationCondition: { field: 'gender', in: ['female'] },
        groupKey: 'q',
      }),
    ],
    expected: 'not_eligible',
  },
  {
    name: 'necessity: conditional with unknown activation field is insufficient information',
    profile: baseProfile({ gender: undefined }),
    reqs: [
      level('bachelor'),
      req({
        ruleType: 'age',
        params: { max: 40, as_of: AS_OF },
        necessity: 'conditional',
        activationCondition: { field: 'gender', in: ['female'] },
        groupKey: 'q',
      }),
    ],
    expected: 'insufficient_information',
  },
  // ---- unknown handling and precedence ----
  {
    name: 'unknown: unverified requirement row needs verification',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'age', params: { max: 32, as_of: AS_OF }, verified: false })],
    expected: 'needs_verification',
    reasons: ['unverified_requirement'],
  },
  {
    name: 'unknown: custom rule needs manual check',
    profile: baseProfile(),
    reqs: [req({ ruleType: 'custom', params: {}, machineEvaluable: false })],
    expected: 'needs_verification',
    reasons: ['manual_check'],
  },
  {
    name: 'precedence: missing profile data is shown before manual checks',
    profile: baseProfile({ dateOfBirth: undefined }),
    reqs: [
      age(32),
      req({ ruleType: 'custom', params: {}, machineEvaluable: false, groupKey: 'c' }),
    ],
    expected: 'insufficient_information',
  },
  {
    name: 'no requirements at all needs verification',
    profile: baseProfile(),
    reqs: [],
    expected: 'needs_verification',
  },
  {
    name: 'only preferred requirements still needs verification',
    profile: baseProfile(),
    reqs: [
      req({
        ruleType: 'skill',
        params: { skill_ids: [1], mode: 'all' },
        necessity: 'preferred',
        groupKey: 'p',
      }),
    ],
    expected: 'needs_verification',
  },
  {
    name: 'conflict: duplicate completed degree with different results',
    profile: baseProfile({ education: [bachelorCse, { ...bachelorCse, resultValue: 3.9 }] }),
    reqs: [level('bachelor')],
    expected: 'insufficient_information',
    reasons: ['profile_conflict'],
  },
];

describe('eligibility case table', () => {
  it.each(cases)('$name', ({ profile, reqs, expected, reasons }) => {
    const r = evaluate(profile, reqs, AS_OF);
    expect(r.status).toBe(expected);
    if (reasons) for (const reason of reasons) expect(r.unknownReasons).toContain(reason);
    if (expected === 'eligible' || expected === 'not_eligible')
      expect(r.unknownReasons).toEqual([]);
  });

  it('has a growing regression table (launch target is 200 cases, plan §19.3)', () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
  });
});

describe('explanations', () => {
  it('names the profile field to add for missing data', () => {
    const r = evaluate(baseProfile({ dateOfBirth: undefined }), [age(32)], AS_OF);
    const rule = r.groups[0]!.branches[0]!.rules[0]!;
    expect(rule.action).toEqual({ type: 'add_profile_field', field: 'dateOfBirth' });
  });

  it('keeps source text and evidence on each outcome', () => {
    const r = evaluate(
      baseProfile(),
      [
        req({
          ruleType: 'age',
          params: { max: 32, as_of: AS_OF },
          sourceText: 'বয়স ৩২ বছর',
          evidence: { documentId: '9001', page: 2 },
        }),
      ],
      AS_OF,
    );
    const rule = r.groups[0]!.branches[0]!.rules[0]!;
    expect(rule.sourceText).toBe('বয়স ৩২ বছর');
    expect(rule.evidence).toEqual({ documentId: '9001', page: 2 });
  });
});

describe('invariants (property-based)', () => {
  const statusArb = fc.record({
    dob: fc.option(
      fc.integer({ min: 1960, max: 2012 }).map((y) => `${y}-06-15`),
      { nil: undefined },
    ),
    level: fc.constantFrom('ssc', 'hsc', 'bachelor', 'masters', 'phd') as fc.Arbitrary<
      'ssc' | 'hsc' | 'bachelor' | 'masters' | 'phd'
    >,
    gender: fc.option(
      fc.constantFrom('female', 'male', 'other') as fc.Arbitrary<'female' | 'male' | 'other'>,
      { nil: undefined },
    ),
  });

  const rulesFor = (maxAge: number, minLevel: string, genders: string[]): Requirement[] => [
    req({ id: 'a', ruleType: 'age', params: { max: maxAge, as_of: AS_OF } }),
    req({ id: 'b', ruleType: 'education_level', params: { min_level: minLevel }, groupKey: 'g1' }),
    req({ id: 'c', ruleType: 'gender', params: { allowed: genders }, groupKey: 'g2' }),
  ];

  it('is deterministic and independent of rule order', () => {
    fc.assert(
      fc.property(statusArb, fc.integer({ min: 18, max: 45 }), (p, maxAge) => {
        const profile = baseProfile({
          dateOfBirth: p.dob,
          gender: p.gender,
          education: [{ ...bachelorCse, level: p.level }],
        });
        const rules = rulesFor(maxAge, 'bachelor', ['female', 'other']);
        const a = evaluate(profile, rules, AS_OF);
        const b = evaluate(profile, [...rules].reverse(), AS_OF);
        expect(a).toEqual(b);
        expect(evaluate(profile, rules, AS_OF)).toEqual(a);
      }),
    );
  });

  it('"eligible" implies every mandatory group passed with no unknown', () => {
    fc.assert(
      fc.property(statusArb, fc.integer({ min: 18, max: 45 }), (p, maxAge) => {
        const profile = baseProfile({
          dateOfBirth: p.dob,
          gender: p.gender,
          education: [{ ...bachelorCse, level: p.level }],
        });
        const r = evaluate(profile, rulesFor(maxAge, 'bachelor', ['female', 'other']), AS_OF);
        if (r.status === 'eligible') {
          expect(r.groups.every((g) => g.result === 'pass')).toBe(true);
          expect(r.summary.unknown).toBe(0);
          expect(r.summary.fail).toBe(0);
        }
      }),
    );
  });

  it('adding missing information never turns not_eligible into eligible', () => {
    fc.assert(
      fc.property(statusArb, fc.integer({ min: 18, max: 45 }), (p, maxAge) => {
        const rules = rulesFor(maxAge, 'bachelor', ['female', 'other']);
        const partial = baseProfile({
          dateOfBirth: p.dob,
          gender: p.gender,
          education: [{ ...bachelorCse, level: p.level }],
        });
        const before = evaluate(partial, rules, AS_OF);
        // fill in what was missing with values that are irrelevant to rules that already failed
        const filled = {
          ...partial,
          dateOfBirth: partial.dateOfBirth ?? '1990-01-01',
          gender: partial.gender ?? ('female' as const),
        };
        const after = evaluate(filled, rules, AS_OF);
        if (before.status === 'not_eligible') expect(after.status).toBe('not_eligible');
      }),
    );
  });
});
