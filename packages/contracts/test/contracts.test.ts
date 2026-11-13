import { describe, expect, it } from 'vitest';
import {
  canTransition,
  consentState,
  fieldObjectSchema,
  hasPermission,
  ROLE_PERMISSIONS,
  UPLOAD_STATES,
  UPLOAD_TRANSITIONS,
  type UploadState,
} from '../src/index';

describe('upload state machine', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('initiated', 'uploaded')).toBe(true);
    expect(canTransition('uploaded', 'validating')).toBe(true);
    expect(canTransition('validating', 'validated')).toBe(true);
    expect(canTransition('initiated', 'validated')).toBe(false); // cannot skip validation
    expect(canTransition('uploaded', 'validated')).toBe(false);
    expect(canTransition('rejected', 'validated')).toBe(false);
    expect(canTransition('expired', 'validated')).toBe(false);
  });

  it('has no path from rejected or expired to validated, exhaustively', () => {
    const reach = (from: UploadState, seen = new Set<UploadState>()): Set<UploadState> => {
      for (const n of UPLOAD_TRANSITIONS[from]) {
        if (!seen.has(n)) {
          seen.add(n);
          reach(n, seen);
        }
      }
      return seen;
    };
    expect(reach('rejected').has('validated')).toBe(false);
    expect(reach('expired').has('validated')).toBe(false);
    for (const s of UPLOAD_STATES) expect(UPLOAD_TRANSITIONS[s]).toBeDefined();
  });

  it('only validating can reach validated', () => {
    const into = UPLOAD_STATES.filter((s) => UPLOAD_TRANSITIONS[s].includes('validated'));
    expect(into).toEqual(['validating']);
  });
});

describe('consent state', () => {
  it('defaults every purpose to off and the latest event wins', () => {
    const s = consentState([
      { purpose: 'analytics', granted: true, at: '2026-11-01T00:00:00Z' },
      { purpose: 'analytics', granted: false, at: '2026-11-02T00:00:00Z' },
      { purpose: 'weekly_digest', granted: true, at: '2026-11-01T00:00:00Z' },
    ]);
    expect(s.analytics).toBe(false);
    expect(s.weekly_digest).toBe(true);
    expect(s.ml_training).toBe(false);
  });
});

describe('permissions', () => {
  it('editors cannot publish; verifiers can', () => {
    expect(hasPermission(['editor'], 'opportunity.publish')).toBe(false);
    expect(hasPermission(['verifier'], 'opportunity.publish')).toBe(true);
  });

  it('only super admin manages roles and removes opportunities', () => {
    expect(hasPermission(['admin'], 'user.manage_roles')).toBe(false);
    expect(hasPermission(['super_admin'], 'user.manage_roles')).toBe(true);
    expect(hasPermission(['admin'], 'opportunity.remove')).toBe(false);
  });

  it('a plain user has no admin permissions', () => {
    expect(ROLE_PERMISSIONS.user.size).toBe(0);
  });
});

describe('field object schema', () => {
  it('requires evidence for stated values', () => {
    expect(fieldObjectSchema.safeParse({ value: '2026-12-15', stated: true }).success).toBe(false);
    expect(
      fieldObjectSchema.safeParse({
        value: '2026-12-15',
        stated: true,
        evidence: { page: 2, quote: 'শেষ তারিখ' },
      }).success,
    ).toBe(true);
  });

  it('rejects invented values when not stated', () => {
    expect(fieldObjectSchema.safeParse({ value: '2099-01-01', stated: false }).success).toBe(false);
    expect(fieldObjectSchema.safeParse({ value: null, stated: false }).success).toBe(true);
  });
});
