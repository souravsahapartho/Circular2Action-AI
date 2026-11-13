/** Eligibility engine types (plan Module C, §9.11, §19.3). Pure data; no I/O. */

export type RuleResult = 'pass' | 'fail' | 'unknown';

export type UnknownReason =
  'missing_profile' | 'manual_check' | 'unverified_requirement' | 'profile_conflict';

export type EligibilityStatus =
  'eligible' | 'not_eligible' | 'needs_verification' | 'insufficient_information';

export type Level = 'ssc' | 'hsc' | 'diploma' | 'bachelor' | 'masters' | 'mphil' | 'phd' | 'other';

export const LEVEL_RANK: Record<Level, number> = {
  other: 0,
  ssc: 1,
  hsc: 2,
  diploma: 3,
  bachelor: 4,
  masters: 5,
  mphil: 6,
  phd: 7,
};

export type ResultScale = 'gpa4' | 'gpa5' | 'percent' | 'class';
export type ResultClass = 'first' | 'second' | 'third';

export interface EducationRecord {
  level: Level;
  disciplineIds?: number[];
  disciplineOther?: string;
  resultScale?: ResultScale;
  resultValue?: number;
  resultClass?: ResultClass;
  status: 'completed' | 'in_progress' | 'appeared';
  startYear?: number;
  passingYear?: number;
}

export interface ExperienceEntry {
  kind: 'job' | 'internship' | 'volunteer' | 'research' | 'teaching';
  from: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd, absent = current
  field?: string;
}

export interface LanguageTestScore {
  test: string;
  overall: number;
  takenOn?: string; // yyyy-mm-dd
}

/**
 * Profile snapshot. An undefined collection means "not provided" (leads to `missing_profile`);
 * an empty array means "provided and none".
 */
export interface Profile {
  dateOfBirth?: string;
  gender?: 'female' | 'male' | 'other';
  nationality?: string;
  homeDistrictId?: number;
  currentDistrictId?: number;
  education?: EducationRecord[];
  experience?: ExperienceEntry[];
  skillIds?: number[];
  languageTests?: LanguageTestScore[];
}

export type RuleType =
  | 'age'
  | 'education_level'
  | 'discipline'
  | 'result'
  | 'experience_years'
  | 'skill'
  | 'nationality'
  | 'district'
  | 'gender'
  | 'language_test'
  | 'passing_year'
  | 'custom';

export type Necessity = 'mandatory' | 'preferred' | 'conditional';

export interface Condition {
  field: 'gender' | 'nationality' | 'homeDistrictId' | 'currentDistrictId';
  in: Array<string | number>;
}

export interface Requirement {
  id: string;
  ruleType: RuleType;
  necessity: Necessity;
  groupKey: string;
  branchKey: string;
  params: Record<string, unknown>;
  activationCondition?: Condition | null;
  machineEvaluable: boolean;
  verified: boolean;
  sourceText?: string;
  evidence?: { documentId?: string; page?: number };
}

export interface RuleAction {
  type: 'add_profile_field' | 'check_manually' | 'verify_requirement';
  field?: string;
}

export interface RuleOutcome {
  requirementId: string;
  ruleType: RuleType;
  necessity: Necessity;
  /** false when a conditional rule's activation condition is not met; it then has no effect */
  active: boolean;
  result: RuleResult;
  reason?: UnknownReason;
  sourceText?: string;
  evidence?: { documentId?: string; page?: number };
  profileValue?: unknown;
  action?: RuleAction;
}

export interface BranchOutcome {
  branchKey: string;
  result: RuleResult;
  rules: RuleOutcome[];
}

export interface GroupOutcome {
  groupKey: string;
  result: RuleResult;
  branches: BranchOutcome[];
}

export interface EvaluationResult {
  status: EligibilityStatus;
  groups: GroupOutcome[];
  preferred: RuleOutcome[];
  summary: { pass: number; fail: number; unknown: number };
  engineVersion: string;
  /** why the status is not Eligible, in priority order (empty for Eligible) */
  unknownReasons: UnknownReason[];
}

export const ENGINE_VERSION = '1.0.0';
