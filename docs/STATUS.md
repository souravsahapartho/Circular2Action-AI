# Implementation status

Last updated: 2026-11-13. Source: `CIRCULAR2ACTION_MASTER_PLAN_v1.1.md`.

## Built and verified locally

| Item | Where | Verification run |
|---|---|---|
| Monorepo, tooling, lint boundary rules | root, `eslint.config.js` | ESLint clean |
| Text normalisation | `packages/normalize` | 11 tests |
| Date/time parsing, Dhaka time, age | `packages/dates` | 27 tests (the tests found and fixed a month-borrow bug in age) |
| Eligibility engine (Kleene logic, groups, branches, conditional rules, conflicts) | `packages/eligibility` | 73 tests: 60+ case table, explanations, 3 property tests |
| Contracts: errors, RBAC, consent, upload state machine, field-object schema | `packages/contracts` | 9 tests |
| API platform: config guards (no keep-alive, no production on free tier), HMAC-signed tick with replay protection, rate limiter, security headers, error mapping, log redaction | `apps/api/src/platform`, `app.ts` | 19 tests |
| AI data-policy gateway: provenance classes DC-A..E, policy matrix, consent checks, no downgrade, content-free ledger, schema repair, contact redaction, SDK/host bypass scan | `apps/api/src/modules/ai` | 96 tests including every class x availability cell |
| Job queue semantics: lease reclaim, heartbeat, graceful release, backoff, dedupe, exactly-once over 1,000 jobs | `apps/api/src/modules/jobs/queue.ts` | in-memory model only; the SQL is untested |
| Reminder materialisation: watermark, grace window, outage catch-up, dedupe | `apps/api/src/modules/jobs/reminders.ts` | tests cover journey 34 scenario |
| Deletion registry + schema completeness scan | `apps/api/src/modules/privacy` | scans all 72 migration tables |
| Provisional migration (72 tables + 1 view) generated from the plan DDL | `apps/api/migrations/0001_init.sql` | structural check only |

Totals at last run: 264 unit tests passing; `tsc` clean in all packages; ESLint clean.

## NOT done (and why)

| Item | Reason |
|---|---|
| Any database applied (gate S-3) | No TiDB instance and no Docker on this machine; needs a local TiDB container or a Starter instance (owner approval for the account) |
| Web app (Next.js), design system, i18n | Not started in this pass |
| Auth, sessions, opportunity CRUD, search, uploads, analyzer, tracker, notifications, admin UI | Depend on the database and on gates S-3, S-5, S-6, S-7, S-8, S-10 |
| Real AI provider, real email provider, real object storage | Need owner-approved accounts (UQ-3, UQ-10/16, UQ-19) and gates S-7, S-8, S-10 |
| GitHub repository, CI run, deployments, domain | Plan rule 21.3.9: each needs explicit owner approval at that time. Workflow files exist locally under `.github/workflows/` but have never run |
| All Phase 0 gates S-1 .. S-11, DS-1 | None has been executed; see `docs/spikes/README.md` |

## Honest caveats

- The migration is generated from the plan and has never been applied to any database.
- The job queue is validated only against an in-memory model of the SQL; gates S-3 and S-6 must test the real statement.
- The leap-day age convention (Feb 29 attains the year on Feb 28 in common years) is an open item for legal confirmation (plan UQ-12).
