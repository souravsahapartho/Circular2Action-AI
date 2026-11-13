/**
 * AiGateway: the only place that may call an AI provider (plan section 13.3, AIP-05).
 * Feature code passes classified inputs; the gateway derives the class, applies the policy, checks the budget,
 * validates the output against a schema (one repair attempt), and records a ledger row without any content.
 */
import { createHash } from 'node:crypto';
import type { ZodType } from 'zod';
import {
  decide,
  type AiConfig,
  type Classified,
  type DataClass,
  type DecisionContext,
} from './policy';

export type AiFeature = 'ocr' | 'extract' | 'summarise' | 'qa' | 'cv_tailor' | 'draft' | 'embed';

export type AiOutcome =
  'ok' | 'schema_invalid' | 'blocked_policy' | 'blocked_budget' | 'provider_error' | 'timeout';

export interface LedgerRow {
  occurredAt: string;
  feature: AiFeature;
  userId?: string;
  jobId?: string;
  aiConfig: AiConfig | null;
  dataClass: DataClass;
  model: string;
  promptId: string;
  promptVersion: string;
  tokensIn: number;
  tokensOut: number;
  costMicroUsd: number;
  latencyMs: number;
  outcome: AiOutcome;
  requestHash: string;
  policyVersion: string;
}

export interface LedgerPort {
  record(row: LedgerRow): Promise<void>;
}

export interface BudgetPort {
  /** Atomically reserve estimated cost; returns false if the budget would be exceeded. */
  reserve(estimatedMicroUsd: number): Promise<boolean>;
}

export interface ProviderRequest {
  config: AiConfig;
  promptId: string;
  promptVersion: string;
  /** plain values after classification; providers never see the Classified wrapper */
  variables: Record<string, unknown>;
  repairErrors?: string[];
}

export interface ProviderResponse {
  json: unknown;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export interface AiProvider {
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
}

export type GatewayResult<T> =
  | { ok: true; data: T; dataClass: DataClass; config: AiConfig }
  | {
      ok: false;
      error:
        | 'AI_DATA_POLICY_BLOCKED'
        | 'CONSENT_REQUIRED'
        | 'AI_BUDGET_EXHAUSTED'
        | 'AI_PROVIDER_UNAVAILABLE'
        | 'SCHEMA_INVALID';
      dataClass: DataClass;
    };

export interface GenerateRequest<T> {
  feature: AiFeature;
  promptId: string;
  promptVersion: string;
  variables: Record<string, Classified<unknown>>;
  schema: ZodType<T>;
  context: DecisionContext;
  userId?: string;
  jobId?: string;
  timeoutMs?: number;
  estimatedMicroUsd?: number;
}

export interface GatewayDeps {
  provider: AiProvider;
  ledger: LedgerPort;
  budget: BudgetPort;
  now: () => Date;
  policyVersion: string;
}

export class AiGateway {
  constructor(private readonly deps: GatewayDeps) {}

  async generateStructured<T>(req: GenerateRequest<T>): Promise<GatewayResult<T>> {
    const started = this.deps.now().getTime();
    const classified = Object.values(req.variables);
    const decision = decide(classified, req.context);
    const requestHash = createHash('sha256')
      .update(`${req.promptId}@${req.promptVersion}:${req.feature}`)
      .digest('hex')
      .slice(0, 16);

    const record = async (
      partial: Pick<LedgerRow, 'outcome'> & Partial<LedgerRow>,
    ): Promise<void> => {
      await this.deps.ledger.record({
        occurredAt: this.deps.now().toISOString(),
        feature: req.feature,
        ...(req.userId ? { userId: req.userId } : {}),
        ...(req.jobId ? { jobId: req.jobId } : {}),
        aiConfig: decision.ok ? decision.config : null,
        dataClass: decision.dataClass,
        model: 'n/a',
        promptId: req.promptId,
        promptVersion: req.promptVersion,
        tokensIn: 0,
        tokensOut: 0,
        costMicroUsd: 0,
        latencyMs: this.deps.now().getTime() - started,
        requestHash,
        policyVersion: this.deps.policyVersion,
        ...partial,
      });
    };

    if (!decision.ok) {
      await record({
        outcome: decision.errorCode === 'AI_BUDGET_EXHAUSTED' ? 'blocked_budget' : 'blocked_policy',
      });
      return { ok: false, error: decision.errorCode, dataClass: decision.dataClass };
    }

    if (decision.config === 'CFG-P') {
      const reserved = await this.deps.budget.reserve(req.estimatedMicroUsd ?? 0);
      if (!reserved) {
        await record({ outcome: 'blocked_budget' });
        return { ok: false, error: 'AI_BUDGET_EXHAUSTED', dataClass: decision.dataClass };
      }
    }

    const plain = Object.fromEntries(Object.entries(req.variables).map(([k, v]) => [k, v.value]));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let tokensIn = 0;
    let tokensOut = 0;
    let model = 'n/a';
    try {
      let repairErrors: string[] | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await this.deps.provider.generate(
          {
            config: decision.config,
            promptId: req.promptId,
            promptVersion: req.promptVersion,
            variables: plain,
            ...(repairErrors ? { repairErrors } : {}),
          },
          controller.signal,
        );
        tokensIn += res.tokensIn;
        tokensOut += res.tokensOut;
        model = res.model;
        const parsed = req.schema.safeParse(res.json);
        if (parsed.success) {
          await record({ outcome: 'ok', tokensIn, tokensOut, model });
          return {
            ok: true,
            data: parsed.data,
            dataClass: decision.dataClass,
            config: decision.config,
          };
        }
        repairErrors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      }
      await record({ outcome: 'schema_invalid', tokensIn, tokensOut, model });
      return { ok: false, error: 'SCHEMA_INVALID', dataClass: decision.dataClass };
    } catch (err) {
      await record({
        outcome: controller.signal.aborted ? 'timeout' : 'provider_error',
        tokensIn,
        tokensOut,
        model,
      });
      void err;
      return { ok: false, error: 'AI_PROVIDER_UNAVAILABLE', dataClass: decision.dataClass };
    } finally {
      clearTimeout(timer);
    }
  }
}
