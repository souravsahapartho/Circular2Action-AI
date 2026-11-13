# Circular2Action AI

Bangladesh opportunity intelligence: verified circulars, explainable eligibility, deadline tracking.

**Status: Phase 0 (foundation), local only.** Nothing is deployed. No cloud account, repository, domain, database
or paid service has been created. See [docs/STATUS.md](docs/STATUS.md) for exactly what exists and what is gated.

Source of truth: [CIRCULAR2ACTION_MASTER_PLAN_v1.1.md](CIRCULAR2ACTION_MASTER_PLAN_v1.1.md).
Audit that produced v1.1: [CIRCULAR2ACTION_IMPLEMENTATION_READINESS_REPORT.md](CIRCULAR2ACTION_IMPLEMENTATION_READINESS_REPORT.md).
(`CIRCULAR2ACTION_MASTER_PLAN.md` is the superseded v1.0 and is kept unmodified.)

## Prerequisites

- Node.js 22 or newer
- pnpm 9 (`corepack pnpm@9.15.0 ...` works without a global install)

## Commands

```bash
corepack pnpm@9.15.0 install
corepack pnpm@9.15.0 -r typecheck
corepack pnpm@9.15.0 -r test
corepack pnpm@9.15.0 exec eslint .
node scripts/build-migration.mjs    # regenerate apps/api/migrations/0001_init.sql from the plan DDL
node scripts/check-migration.mjs    # structural check only; the SQL is NOT applied to any database
```

## Layout

| Path | Purpose |
|---|---|
| `packages/normalize` | Unicode, Bangla digit folding, tokenising, slugs (plan §9.8) |
| `packages/dates` | Bangla/English date and time parsing, Dhaka time, age (plan §13.5) |
| `packages/eligibility` | Deterministic three-valued eligibility engine (plan Module C) |
| `packages/contracts` | Error codes, permissions, consent purposes, upload state machine, schemas |
| `apps/api` | Fastify platform skeleton, AI data-policy gateway, job queue and reminder logic, deletion registry |
| `apps/api/migrations` | Generated, **provisional** SQL (gate S-3 pending) |
| `docs/` | Status, ADR index, spike (gate) tracker, runbook placeholders |
| `scripts/` | Migration generator and checker |

## Rules for contributors (from the plan)

- No secrets in the repository. `.env.example` lists names only.
- AI is called only through `AiGateway`; provider SDKs, hosts and keys exist only under
  `apps/api/src/modules/ai/providers/` (enforced by lint and a test).
- Business code uses the injected `Clock`, never `Date.now()` or `new Date()`.
- Configuration is read only in `apps/api/src/platform/config.ts`.
- The free hosting tier is for development and testing only. A scheduler interval below 30 minutes on it is refused.
- Do not claim a test, build or deployment succeeded without running it.
