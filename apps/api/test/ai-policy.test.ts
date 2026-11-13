import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { AiGateway, type LedgerRow } from '../src/modules/ai/gateway';
import {
  classOfAll,
  decide,
  POLICY_MATRIX,
  pub,
  sens,
  usr,
  type AiConfig,
  type DataClass,
  type DecisionContext,
} from '../src/modules/ai/policy';
import { MockProvider } from '../src/modules/ai/providers/mock';
import { looksLikePersonalData, redactContacts, restoreContacts } from '../src/modules/ai/redact';

const ctx = (over: Partial<DecisionContext> = {}): DecisionContext => ({
  available: new Set<AiConfig>(['CFG-F', 'CFG-P']),
  consent: new Set(['ai_processing_personal']),
  uploadedCircularConsent: true,
  freeQuotaAvailable: true,
  paidBudgetAvailable: true,
  ...over,
});

describe('classification derives from provenance', () => {
  it('takes the highest class of all inputs', () => {
    expect(classOfAll([pub('x')])).toBe('DC-A');
    expect(classOfAll([pub('x'), usr('q', 'user_free_text')])).toBe('DC-B');
    expect(classOfAll([pub('x'), usr('profile', 'user_profile')])).toBe('DC-C');
    expect(classOfAll([usr('cv', 'user_cv'), usr('a@b.com', 'user_contact')])).toBe('DC-D');
    expect(classOfAll([pub('x'), sens('application-id-123')])).toBe('DC-E');
  });
});

describe('policy matrix (every class x configuration availability)', () => {
  const classes: Array<[DataClass, ReturnType<typeof pub>]> = [
    ['DC-A', pub('doc')],
    ['DC-B', usr('q', 'user_free_text') as never],
    ['DC-C', usr('cv', 'user_cv') as never],
    ['DC-D', usr('t', 'user_document') as never],
    ['DC-E', sens('secret') as never],
  ];
  const availabilities: Array<Set<AiConfig>> = [
    new Set(),
    new Set(['CFG-F']),
    new Set(['CFG-P']),
    new Set(['CFG-F', 'CFG-P']),
  ];

  for (const [cls, input] of classes) {
    for (const avail of availabilities) {
      for (const free of [true, false]) {
        for (const paid of [true, false]) {
          it(`${cls} available=[${[...avail].join(',')}] freeQuota=${free} paidBudget=${paid}`, () => {
            const d = decide(
              [input],
              ctx({ available: avail, freeQuotaAvailable: free, paidBudgetAvailable: paid }),
            );
            expect(d.dataClass).toBe(cls);
            // invariants that must hold in every cell
            if (cls === 'DC-D' || cls === 'DC-E') expect(d.ok).toBe(false);
            if (d.ok) {
              expect(POLICY_MATRIX[cls]).toContain(d.config);
              expect(avail.has(d.config)).toBe(true);
              if (cls !== 'DC-A') expect(d.config).toBe('CFG-P'); // never the unpaid configuration for personal-capable data
              if (d.config === 'CFG-P') expect(paid).toBe(true);
              if (d.config === 'CFG-F') expect(free).toBe(true);
            }
          });
        }
      }
    }
  }

  it('DC-A prefers the unpaid configuration while quota remains, then the paid one', () => {
    expect(decide([pub('d')], ctx())).toMatchObject({ ok: true, config: 'CFG-F' });
    expect(decide([pub('d')], ctx({ freeQuotaAvailable: false }))).toMatchObject({
      ok: true,
      config: 'CFG-P',
    });
  });

  it('never downgrades: personal data with no paid configuration is blocked, not sent unpaid', () => {
    const d = decide([usr('cv', 'user_cv')], ctx({ available: new Set<AiConfig>(['CFG-F']) }));
    expect(d).toMatchObject({ ok: false, errorCode: 'AI_DATA_POLICY_BLOCKED' });
  });

  it('requires consent for personal data and for uploaded circulars', () => {
    expect(decide([usr('p', 'user_profile')], ctx({ consent: new Set() }))).toMatchObject({
      ok: false,
      errorCode: 'CONSENT_REQUIRED',
    });
    expect(
      decide([usr('doc', 'user_upload')], ctx({ uploadedCircularConsent: false })),
    ).toMatchObject({ ok: false, errorCode: 'CONSENT_REQUIRED' });
    expect(decide([usr('doc', 'user_upload')], ctx())).toMatchObject({ ok: true, config: 'CFG-P' });
  });

  it('reports budget exhaustion on the paid configuration distinctly', () => {
    expect(decide([usr('q', 'user_free_text')], ctx({ paidBudgetAvailable: false }))).toMatchObject(
      { ok: false, errorCode: 'AI_BUDGET_EXHAUSTED' },
    );
  });

  it('keeps EEA, UK and Switzerland users off the unpaid configuration even for public documents', () => {
    expect(decide([pub('d')], ctx({ userInEeaUkCh: true }))).toMatchObject({
      ok: true,
      config: 'CFG-P',
    });
    expect(
      decide([pub('d')], ctx({ userInEeaUkCh: true, available: new Set<AiConfig>(['CFG-F']) })),
    ).toMatchObject({ ok: false });
  });

  it('a single sensitive value poisons an otherwise public call', () => {
    expect(decide([pub('doc'), pub('more'), sens('exam-roll-5521')], ctx())).toMatchObject({
      ok: false,
      reason: 'DC_E_PROHIBITED',
    });
  });
});

describe('gateway behaviour', () => {
  const schema = z.object({ summary: z.string() });
  const mk = (responder: () => unknown, over: Partial<{ reserve: boolean }> = {}) => {
    const provider = new MockProvider(responder);
    const rows: LedgerRow[] = [];
    const gateway = new AiGateway({
      provider,
      ledger: { record: async (r) => void rows.push(r) },
      budget: { reserve: async () => over.reserve ?? true },
      now: () => new Date('2026-11-13T10:00:00Z'),
      policyVersion: 'p1',
    });
    return { provider, rows, gateway };
  };

  it('does not call the provider when the policy blocks, and still writes a content-free ledger row', async () => {
    const { provider, rows, gateway } = mk(() => ({ summary: 'x' }));
    const r = await gateway.generateStructured({
      feature: 'summarise',
      promptId: 'summarise.circular',
      promptVersion: 'v1',
      variables: { text: sens('SECRET-APPLICATION-ID') },
      schema,
      context: ctx(),
    });
    expect(r).toMatchObject({ ok: false, error: 'AI_DATA_POLICY_BLOCKED' });
    expect(provider.calls).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('SECRET-APPLICATION-ID');
    expect(rows[0]).toMatchObject({ outcome: 'blocked_policy', aiConfig: null, dataClass: 'DC-E' });
  });

  it('passes plain values to the provider, records the class and configuration, and returns validated data', async () => {
    const { provider, rows, gateway } = mk(() => ({ summary: 'ok' }));
    const r = await gateway.generateStructured({
      feature: 'summarise',
      promptId: 'summarise.circular',
      promptVersion: 'v1',
      variables: { text: pub('official circular text') },
      schema,
      context: ctx(),
    });
    expect(r).toMatchObject({
      ok: true,
      data: { summary: 'ok' },
      config: 'CFG-F',
      dataClass: 'DC-A',
    });
    expect(provider.calls[0]?.variables).toEqual({ text: 'official circular text' });
    expect(rows[0]).toMatchObject({
      outcome: 'ok',
      aiConfig: 'CFG-F',
      dataClass: 'DC-A',
      policyVersion: 'p1',
    });
    expect(JSON.stringify(rows)).not.toContain('official circular text');
  });

  it('retries once with validation errors and then fails with SCHEMA_INVALID', async () => {
    const { provider, gateway } = mk(() => ({ wrong: true }));
    const r = await gateway.generateStructured({
      feature: 'extract',
      promptId: 'extract.circular',
      promptVersion: 'v1',
      variables: { text: pub('doc') },
      schema,
      context: ctx(),
    });
    expect(r).toMatchObject({ ok: false, error: 'SCHEMA_INVALID' });
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]?.repairErrors?.length).toBeGreaterThan(0);
  });

  it('repairs on the second attempt', async () => {
    let n = 0;
    const { gateway } = mk(() => (++n === 1 ? { nope: 1 } : { summary: 'fixed' }));
    const r = await gateway.generateStructured({
      feature: 'extract',
      promptId: 'extract.circular',
      promptVersion: 'v1',
      variables: { text: pub('doc') },
      schema,
      context: ctx(),
    });
    expect(r).toMatchObject({ ok: true, data: { summary: 'fixed' } });
  });

  it('stops before the paid provider when the budget reservation fails', async () => {
    const { provider, gateway } = mk(() => ({ summary: 'x' }), { reserve: false });
    const r = await gateway.generateStructured({
      feature: 'qa',
      promptId: 'qa.circular',
      promptVersion: 'v1',
      variables: { q: usr('question', 'user_free_text') },
      schema,
      context: ctx(),
    });
    expect(r).toMatchObject({ ok: false, error: 'AI_BUDGET_EXHAUSTED' });
    expect(provider.calls).toHaveLength(0);
  });
});

describe('contact redaction', () => {
  it('replaces emails and Bangladesh mobile numbers (Latin and Bangla digits) and restores them', () => {
    const input = 'যোগাযোগ: rahim@example.com, ফোন ০১৭১২৩৪৫৬৭৮ এবং +8801812345678';
    const r = redactContacts(input);
    expect(r.text).not.toContain('rahim@example.com');
    expect(r.text).not.toContain('০১৭১২৩৪৫৬৭৮');
    expect(r.text).not.toContain('01812345678');
    expect(Object.keys(r.map).length).toBe(3);
    expect(restoreContacts(r.text, r.map)).toBe(input);
  });

  it('redacts long identifiers and leaves ordinary numbers alone', () => {
    const r = redactContacts('NID 1991234567890, posts: 12, year 2026');
    expect(r.text).toContain('posts: 12');
    expect(r.text).toContain('2026');
    expect(r.text).not.toContain('1991234567890');
  });

  it('screens anonymous free text for personal data', () => {
    expect(looksLikePersonalData('Am I eligible? my mail is a@b.com')).toBe(true);
    expect(looksLikePersonalData('call me 01712345678')).toBe(true);
    expect(looksLikePersonalData('What is the application fee for this circular?')).toBe(false);
  });
});

describe('bypass prevention (AIP-05)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..', '..');
  const allowedDir = path.join('apps', 'api', 'src', 'modules', 'ai', 'providers');
  const forbidden = [
    'generativelanguage.googleapis.com',
    '@google/genai',
    '@google/generative-ai',
    'GEMINI_API_KEY',
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.next', 'coverage'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it('keeps provider SDKs, hosts and keys inside the gateway providers directory only', () => {
    const offenders: string[] = [];
    for (const dir of ['apps', 'packages']) {
      for (const file of walk(path.join(root, dir))) {
        const rel = path.relative(root, file);
        if (rel.startsWith(allowedDir)) continue;
        if (rel.endsWith('ai-policy.test.ts')) continue; // this test names the forbidden strings
        const text = fs.readFileSync(file, 'utf8');
        for (const f of forbidden) if (text.includes(f)) offenders.push(`${rel}: ${f}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
