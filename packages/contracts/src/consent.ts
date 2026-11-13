/** Consent purposes and defaults (plan CON-01). Optional purposes default to off and are never pre-ticked. */
export const CONSENT_PURPOSES = {
  terms: { required: true },
  privacy: { required: true },
  weekly_digest: { required: false },
  analytics: { required: false },
  ai_processing_uploaded_circulars: { required: false },
  ai_processing_personal: { required: false },
  submit_for_publication: { required: false },
  ml_training: { required: false },
} as const;

export type ConsentPurpose = keyof typeof CONSENT_PURPOSES;
export const CONSENT_PURPOSE_LIST = Object.keys(CONSENT_PURPOSES) as ConsentPurpose[];

export interface ConsentEvent {
  purpose: ConsentPurpose;
  granted: boolean;
  /** ISO timestamp */
  at: string;
}

/** Latest event wins; no event means not granted (defaults off). */
export function consentState(events: readonly ConsentEvent[]): Record<ConsentPurpose, boolean> {
  const out = Object.fromEntries(CONSENT_PURPOSE_LIST.map((p) => [p, false])) as Record<
    ConsentPurpose,
    boolean
  >;
  const latest = new Map<ConsentPurpose, ConsentEvent>();
  for (const e of events) {
    const cur = latest.get(e.purpose);
    if (!cur || e.at >= cur.at) latest.set(e.purpose, e);
  }
  for (const [p, e] of latest) out[p] = e.granted;
  return out;
}
