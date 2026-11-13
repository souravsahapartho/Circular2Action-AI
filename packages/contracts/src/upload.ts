/** Upload state machine (plan §15.6, UP-01, UP-02). Anything not listed is a bug and is rejected. */
export const UPLOAD_STATES = [
  'initiated',
  'uploaded',
  'validating',
  'validated',
  'rejected',
  'expired',
  'deleted',
] as const;
export type UploadState = (typeof UPLOAD_STATES)[number];

export const UPLOAD_TRANSITIONS: Record<UploadState, readonly UploadState[]> = {
  initiated: ['uploaded', 'expired'],
  uploaded: ['validating', 'rejected', 'expired'],
  validating: ['validated', 'rejected', 'expired'],
  validated: ['deleted'],
  rejected: [],
  expired: [],
  deleted: [],
};

export function canTransition(from: UploadState, to: UploadState): boolean {
  return UPLOAD_TRANSITIONS[from].includes(to);
}

export const UPLOAD_REJECT_CODES = [
  'SIZE_MISMATCH',
  'TYPE_MISMATCH',
  'ENCRYPTED_PDF',
  'PAGE_LIMIT',
  'PIXEL_LIMIT',
  'PARSE_ERROR',
  'DENYLISTED',
  'TIMEOUT',
] as const;
export type UploadRejectCode = (typeof UPLOAD_REJECT_CODES)[number];

/** Only validated uploads are visible to the AI pipeline and to downloads (UP-11). */
export function isReadableByPipeline(state: UploadState): boolean {
  return state === 'validated';
}
