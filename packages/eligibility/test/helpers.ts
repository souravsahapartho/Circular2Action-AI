import type { EducationRecord, Profile, Requirement } from '../src/index';

let seq = 0;
export function req(
  partial: Partial<Requirement> & Pick<Requirement, 'ruleType' | 'params'>,
): Requirement {
  seq += 1;
  return {
    id: partial.id ?? `r${String(seq).padStart(4, '0')}`,
    necessity: 'mandatory',
    groupKey: 'g0',
    branchKey: 'b0',
    machineEvaluable: true,
    verified: true,
    ...partial,
  };
}

export const bachelorCse: EducationRecord = {
  level: 'bachelor',
  disciplineIds: [12],
  resultScale: 'gpa4',
  resultValue: 3.4,
  status: 'completed',
  startYear: 2018,
  passingYear: 2022,
};

export const baseProfile = (over: Partial<Profile> = {}): Profile => ({
  dateOfBirth: '1999-05-10',
  gender: 'female',
  nationality: 'BD',
  homeDistrictId: 301,
  currentDistrictId: 301,
  education: [bachelorCse],
  experience: [],
  skillIds: [1, 2],
  languageTests: [],
  ...over,
});

export const AS_OF = '2026-11-01';
