/**
 * AI data classification and central policy (plan section 13.9, AIP-01 to AIP-14).
 * The class is derived from the provenance of the inputs. Callers cannot declare or lower it.
 */
import type { ConsentPurpose } from '@c2a/contracts';

export type DataClass = 'DC-A' | 'DC-B' | 'DC-C' | 'DC-D' | 'DC-E';
export type AiConfig = 'CFG-N' | 'CFG-F' | 'CFG-P' | 'CFG-L';

export type Provenance =
  | 'staff_public' // official document entered by staff
  | 'public_web_approved' // approved source or staff-entered URL
  | 'user_free_text' // visitor or user questions, user-supplied URL content
  | 'user_upload' // user-uploaded circular
  | 'user_profile'
  | 'user_cv'
  | 'user_document' // transcripts, certificates, vault files
  | 'user_contact' // user's own email, phone, address
  | 'app_secret'
  | 'app_sensitive'; // application ids, payment details, notes, exam/interview details

export const CLASS_BY_PROVENANCE: Record<Provenance, DataClass> = {
  staff_public: 'DC-A',
  public_web_approved: 'DC-A',
  user_free_text: 'DC-B',
  user_upload: 'DC-C',
  user_profile: 'DC-C',
  user_cv: 'DC-C',
  user_document: 'DC-D',
  user_contact: 'DC-D',
  app_secret: 'DC-E',
  app_sensitive: 'DC-E',
};

const RANK: Record<DataClass, number> = { 'DC-A': 1, 'DC-B': 2, 'DC-C': 3, 'DC-D': 4, 'DC-E': 5 };

declare const classifiedBrand: unique symbol;
/** A value tagged with its provenance. Only the constructors below can create one. */
export interface Classified<T> {
  readonly [classifiedBrand]: true;
  readonly value: T;
  readonly provenance: Provenance;
}

function make<T>(value: T, provenance: Provenance): Classified<T> {
  return { value, provenance } as unknown as Classified<T>;
}

/** Public official content. */
export const pub = <T>(
  value: T,
  provenance: 'staff_public' | 'public_web_approved' = 'staff_public',
): Classified<T> => make(value, provenance);

/** Anything that comes from a user. */
export const usr = <T>(
  value: T,
  provenance:
    | 'user_free_text'
    | 'user_upload'
    | 'user_profile'
    | 'user_cv'
    | 'user_document'
    | 'user_contact',
): Classified<T> => make(value, provenance);

/** Sensitive application data. A call containing it is always rejected (DC-E). */
export const sens = <T>(value: T): Classified<T> => make(value, 'app_sensitive');

export function classOfAll(inputs: ReadonlyArray<Classified<unknown>>): DataClass {
  let max: DataClass = 'DC-A';
  for (const i of inputs) {
    const c = CLASS_BY_PROVENANCE[i.provenance];
    if (RANK[c] > RANK[max]) max = c;
  }
  return max;
}

/** Policy matrix (AIP-01). DC-D is blocked in the MVP; DC-E is never allowed. */
export const POLICY_MATRIX: Record<DataClass, readonly AiConfig[]> = {
  'DC-A': ['CFG-F', 'CFG-P'],
  'DC-B': ['CFG-P'],
  'DC-C': ['CFG-P'],
  'DC-D': [],
  'DC-E': [],
};

/** Consent needed before a class may be processed (CON-06). */
export const REQUIRED_CONSENT: Partial<Record<DataClass, ConsentPurpose>> = {
  'DC-C': 'ai_processing_personal',
};

export type BlockReason =
  | 'DC_E_PROHIBITED'
  | 'DC_D_BLOCKED_IN_MVP'
  | 'CONFIG_UNAVAILABLE'
  | 'CONSENT_REQUIRED'
  | 'BUDGET_EXHAUSTED';

export type Decision =
  | { ok: true; dataClass: DataClass; config: AiConfig }
  | {
      ok: false;
      dataClass: DataClass;
      reason: BlockReason;
      errorCode: 'AI_DATA_POLICY_BLOCKED' | 'CONSENT_REQUIRED' | 'AI_BUDGET_EXHAUSTED';
    };

export interface DecisionContext {
  /** configurations that are enabled and have credentials */
  available: ReadonlySet<AiConfig>;
  /** consent purposes the user has granted */
  consent: ReadonlySet<ConsentPurpose>;
  /** extra consent specifically needed for user-uploaded circulars (B-24) */
  uploadedCircularConsent?: boolean;
  /** unpaid quota left for DC-A work */
  freeQuotaAvailable: boolean;
  paidBudgetAvailable: boolean;
  /** user-triggered call by someone in the EEA, UK or Switzerland: unpaid terms exclude them (AIP-14) */
  userInEeaUkCh?: boolean;
}

/**
 * Decide whether and where a call may run. Never downgrades to a less private configuration.
 * `inputs` must contain every variable and attachment that will reach the provider.
 */
export function decide(inputs: ReadonlyArray<Classified<unknown>>, ctx: DecisionContext): Decision {
  const dataClass = classOfAll(inputs);
  const blocked = (
    reason: BlockReason,
    errorCode: 'AI_DATA_POLICY_BLOCKED' | 'CONSENT_REQUIRED' | 'AI_BUDGET_EXHAUSTED',
  ): Decision => ({
    ok: false,
    dataClass,
    reason,
    errorCode,
  });

  if (dataClass === 'DC-E') return blocked('DC_E_PROHIBITED', 'AI_DATA_POLICY_BLOCKED');
  if (dataClass === 'DC-D') return blocked('DC_D_BLOCKED_IN_MVP', 'AI_DATA_POLICY_BLOCKED');

  const needed = REQUIRED_CONSENT[dataClass];
  if (needed && !ctx.consent.has(needed)) return blocked('CONSENT_REQUIRED', 'CONSENT_REQUIRED');
  if (inputs.some((i) => i.provenance === 'user_upload') && !ctx.uploadedCircularConsent) {
    return blocked('CONSENT_REQUIRED', 'CONSENT_REQUIRED');
  }

  let candidates = POLICY_MATRIX[dataClass].filter((c) => ctx.available.has(c));
  if (ctx.userInEeaUkCh) candidates = candidates.filter((c) => c !== 'CFG-F');
  if (candidates.length === 0) return blocked('CONFIG_UNAVAILABLE', 'AI_DATA_POLICY_BLOCKED');

  // cheapest permitted configuration first: unpaid when allowed and quota remains, otherwise paid
  if (candidates.includes('CFG-F') && ctx.freeQuotaAvailable)
    return { ok: true, dataClass, config: 'CFG-F' };
  if (candidates.includes('CFG-P')) {
    if (!ctx.paidBudgetAvailable) return blocked('BUDGET_EXHAUSTED', 'AI_BUDGET_EXHAUSTED');
    return { ok: true, dataClass, config: 'CFG-P' };
  }
  return blocked('CONFIG_UNAVAILABLE', 'AI_DATA_POLICY_BLOCKED');
}
