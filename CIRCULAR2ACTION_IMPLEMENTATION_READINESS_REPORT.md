# Circular2Action AI — Implementation Readiness Report

**Audit of `CIRCULAR2ACTION_MASTER_PLAN.md` v1.0.0 and basis for Master Plan v1.1.0**

| | |
|---|---|
| Report date | 2026-11-13 |
| Audited document | `CIRCULAR2ACTION_MASTER_PLAN.md`, version 1.0.0 (4,767 lines, about 55,000 words) |
| Companion deliverable | `CIRCULAR2ACTION_MASTER_PLAN_v1.1.md` (version 1.1.0) |
| Scope | Planning and review only. No source code, repository, deployment, database, cloud resource, account, domain or paid service was created. |
| Reviewer roles | Software architect, technical lead, security engineer, QA lead, product-systems reviewer |

## How this audit was done (and what it did not do)

- **Reading.** I read the whole of v1.0 from line 1 to line 4,767 in sequential chunks before changing anything. Findings were written to a scratch file as I went, so none depend on memory or on summaries.
- **Official-source research.** On 2026-11-13 I had official pages fetched for Render, Google Gemini API (terms, pricing, usage policies, logs policy, Files API, billing), TiDB Cloud and TiDB documentation, Resend, Amazon SES, Postmark, Mailgun, Google's sender requirements, Cloudflare R2 and Turnstile, GitHub Actions billing, Sentry, cron-job.org, Vercel and OWASP. The pages were retrieved by a web-fetch helper and reported back with quotes; I did not open them myself. Where a page failed, was JavaScript-only, or its body was not retrievable, the item is recorded as **NOT FOUND** or **UNAVAILABLE**, never filled in from memory.
- **Local checks.** I recomputed every colour-contrast figure in v1.0 and the sample-size statistics behind the accuracy gates with a small Node script (kept outside the project root).
- **Not done.** I did not run any database, hosting, email or AI experiment. Everything that needs an experiment is turned into a pass/fail gate (§9) rather than asserted. I did not obtain legal advice; legal questions are flagged for counsel.

Evidence tags used below: **[V]** verified from an official page on 2026-11-13; **[V-sec]** verified only from a secondary source; **[NF]** not found / unavailable; **[A]** assumption; **[RV]** requires validation by a spike or counsel.

---

## 1. Executive summary

v1.0 is a coherent and unusually thorough plan. Its product direction (evidence-linked extraction, deterministic eligibility, human verification, source discipline) is sound and I preserved it. The audit found **49 findings: 8 Critical, 14 High, 15 Medium, 12 Low** (two Low findings, RF-048 and RF-049, were added after mechanical validation of v1.0). None of them require changing the product. They require changing how the platform is hosted and validated, and filling several gaps that would otherwise force an implementing agent to guess.

The most important conclusions:

1. **The scheduler design in v1.0 is not acceptable as written.** A tick every 10 minutes keeps a Render free instance awake for about 730 of its 750 free hours, and Render's own free-tier page says free instances are "not for production applications" [V]. v1.1 removes the keep-alive pattern and defines three explicit setups: free for development and testing only, a paid always-on instance for production, and an optional Render Cron Job.
2. **Personal data could reach the wrong Gemini configuration.** v1.0's two-value `dataClass` is declared by the caller, user-uploaded circulars are not classified at all, and the free tier's terms say not to submit personal information and that human reviewers may read content [V]. v1.1 adds a policy of eight data categories mapped to five classes, enforced inside `AiGateway`, with provenance-derived classification and an SDK-import ban.
3. **The database design depends on TiDB features that v1.0 never tested**, and its CI runs MySQL 8, which cannot execute `AUTO_RANDOM` or `VECTOR` DDL. TiDB documents show CHECK constraints are off by default, `SKIP LOCKED` is unsupported, full-text search is a public preview that lists no Bengali support, free-tier backups are daily with one-day retention and no point-in-time or manual backup, and multiple SQL users on Starter could not be confirmed [V/NF].
4. **The accuracy gates cannot be proven with the dataset v1.0 specifies.** With 50 held-out documents, an observed 48/50 correct has a 95% interval of 86.5% to 98.9%. Demonstrating "99% precision" needs roughly 300 error-free instances. v1.1 replaces the claims with confidence-interval gates, a three-way split and a production audit.
5. **Account deletion, consent proof, backups, audit logs and AI history contradict each other.** v1.1 defines a deletion matrix, a pseudonymous consent-proof design, a restartable deletion workflow and a backup-restore replay ledger. The consent-proof retention period and anything legal is left for counsel.
6. **The upload pipeline has no state machine,** and presigned PUT URLs cannot enforce a size limit on Cloudflare R2 (POST policies are not supported [V]). v1.1 defines states, transitions, a physically separate quarantine bucket and server-side checks.
7. **Transactional email is a Phase 1 dependency that v1.0 placed in Phase 2,** recommended a provider whose free limits could not be verified, and set a default cap above the verified free limit of the alternative. v1.1 recommends Resend (verified limits) with Amazon SES as fallback, behind an interface, and marks every account and subscription as an owner decision.
8. **Phase 0 spikes were tasks, not gates.** v1.1 turns them into eleven pass/fail gates with procedures, thresholds and fallbacks, and forbids dependent Phase 1 work from starting until they pass.

## 2. Overall readiness assessment

| Area | v1.0 | v1.1 | Remaining blocker |
|---|---|---|---|
| Product scope and requirements | Strong; a few P0 gaps (transactional email, consent management) | Gaps filled | None |
| Architecture | Sound modular monolith; hosting and scheduler unsound for production | Corrected | Gates S-5, S-6 |
| Database | Good structure; platform assumptions untested; missing tables | Corrected and gated | Gate S-3 |
| API | Mostly consistent; missing endpoints, errors, limits | Corrected | None |
| AI | Good controls; privacy policy and evaluation inadequate | Corrected | Gates S-2, S-4, S-10; owner decision UQ-3 |
| Security and privacy | Strong baseline; upload and deletion incomplete | Corrected | Gates S-8, S-11; counsel |
| Testing | Broad; CI database mismatch; gaps | Corrected | None |
| Deployment, cost, operations | Several stale or unverified facts | Corrected | Gate S-9; owner decisions |

**Verdict: the project is NOT ready for Phase 1 implementation.** It is ready for **Phase 0** (repository, tooling, design tokens, and the eleven validation gates) once the owner approves the specific resources that Phase 0 creates (§10). Phase 1 may begin per module only when that module's gates have passed or an owner-approved fallback is recorded (§9.3).

## 3. Critical blockers

| ID | Blocker | What clears it |
|---|---|---|
| RF-001 | Scheduler design depends on keeping a free instance awake; production on free tier | v1.1 §9.7, §9.14; gate S-6; owner decision UQ-15 (paid always-on API instance) |
| RF-002 | No enforceable AI data classification | v1.1 §13.9; gate S-10; owner decision UQ-3 |
| RF-003 | TiDB behaviour untested; CI cannot run the schema | v1.1 §11.20, §21.2; gate S-3 |
| RF-004 | Accuracy gates statistically unsupported | v1.1 §13.8; gates S-2, S-4 |
| RF-005 | Deletion, consent and retention contradictory | v1.1 §15.9, §11.21; gate S-11; counsel UQ-17 |
| RF-006 | Upload lifecycle undefined | v1.1 §15.6; gate S-8 |
| RF-007 | Transactional email undefined and unvalidated | v1.1 Module F2, §9.15; gate S-7; owner decisions UQ-10, UQ-6 |
| RF-008 | Phase 0 spikes not gating | v1.1 §26.1 |

## 4. High-priority issues

RF-009 to RF-022 are listed in full in §6. In one line each: job-claim SQL never reclaims expired locks (009); no graceful-shutdown or heartbeat design (010); reminders lack catch-up semantics after an outage (011); CI uses MySQL 8 (012); email is placed in Phase 2 although P0 flows need it, and the "zero-spend" scenario still includes the analyzer (013); Gemini logging defaults, retention, Contributor tier and EEA terms are absent from the plan (014); backup and restore rest on an unvalidated export path (015); no consent-management API or schema for several purposes (016); the "submit for publication" data path is undefined (017); six tables are referenced but not defined (018); idempotency keys have no storage (019); alerting depends on the process that may be asleep (020); free-instance CPU, memory and outbound-traffic limits conflict with the performance budgets (021); the cost section contains stale or incorrect provider facts and two invalid recommendations (022).

## 5. Medium and low issues

Medium: RF-023 to RF-037. Low: RF-038 to RF-049. Full text in §6.

## 6. Findings (all 49)

Format for each finding: **Severity**, **Affected v1.0 sections**, **Description**, **Why it matters**, **Correction** (with the v1.1 location), **Owner approval needed**, **Validation method**.

### Critical

#### RF-001 — Scheduler and hosting design conflicts with free-tier policy
- **Severity:** Critical. **Affected:** §9.1, §9.7 (JOB-2 and "Free-tier consequence"), §9.12, ADR-003, ADR-006, RK-10, RK-15, UQ-13, §24.1 Render row.
- **Description:** v1.0 has an external scheduler call `POST /internal/tick` every 10 minutes, states this "keeps the Render service awake nearly continuously" and "uses roughly all 750 free instance hours", and lists "tick keep-warm" as a mitigation. Render's free page says a free web service spins down after 15 minutes without inbound traffic and that "Do not use them for production applications" [V]. The plan also treats the free instance as the launch host.
- **Why it matters:** Artificial keep-alive is explicitly out of bounds for this review. It would consume the whole workspace's free hours with one service, leave nothing for staging, and the free page warns that Render "might restart a Free web service at any time" and may suspend services with high outbound traffic (which includes calls to an external database, external APIs and external object storage, the plan's entire data path) [V]. Render's terms and acceptable-use pages could not be read [NF], so permissibility cannot be asserted either way.
- **Correction:** Remove keep-alive. Define three setups (v1.1 §9.14): **E0** free (development, test and closed alpha only; ticks no more often than every 30 minutes so the service really sleeps between them; no real user may depend on deadline alerts), **E1** production on a paid always-on Render instance (in-process scheduler with a database lease; external ticks become a redundant trigger and dead-man monitor, not a keep-alive), **E2** E1 plus an optional Render Cron Job (minimum US$1 per month per cron job, billed per second [V]). The Render Starter monthly price is not on the official pages I could read [NF]; it stays an owner-verified figure.
- **Owner approval:** Yes (paid hosting, UQ-15).
- **Validation:** Gate S-6 (kill/restart matrix, awake-hours measurement on E0, dead-man alert).

#### RF-002 — No enforceable AI data-classification policy
- **Severity:** Critical. **Affected:** §13.1 (AI-PRIV-1), §13.3 (`dataClass: 'public' | 'personal'`), ADR-009, T-19, RK-08, SEC-46, §19.4.
- **Description:** Classification is a two-value flag set by the calling feature. Nothing stops a feature author from labelling personal content `public`. User-uploaded circulars (B-02, US-03) are not classified, yet a photo of a circular can contain names, numbers and marks. Free-text questions from anonymous users are not covered. Contact details and application identifiers have no rule.
- **Why it matters:** Gemini's unpaid terms say content may be used to improve Google products, human reviewers may read it, and "Do not submit sensitive, confidential, or personal information to the Unpaid Services" [V, `aistudio.google.com/docs/terms`, effective 2026-03-23]. A single mislabelled call would breach the plan's own principle and the provider's terms.
- **Correction:** v1.1 §13.9: eight data categories mapped to five classes (DC-A to DC-E), four AI configurations, provenance-derived classification, branded input types, keys isolated inside the gateway, lint and CI bans on provider SDK or host strings outside it, consent purposes, retention, a blocked-or-fallback rule, and a policy matrix tested at 100%.
- **Owner approval:** Yes (paid Gemini project and budget, UQ-3; acceptance that user-uploaded circular analysis needs the paid configuration, UQ-18).
- **Validation:** Gate S-10 (matrix tests, bypass attempts, canary strings in logs, console verification of project settings).

#### RF-003 — TiDB compatibility unvalidated while the schema depends on it
- **Severity:** Critical. **Affected:** §11.1, §11.16, §11.18, ADR-005, ADR-008, ADR-014, §19.1, §21.2.
- **Description:** The DDL uses `AUTO_RANDOM`, `VECTOR(768)`, a possible `FULLTEXT` index, foreign keys, JSON, and an `UPDATE ... ORDER BY ... LIMIT` queue claim. v1.0 marks enforcement as "verified in spike S-3 [RV]" but allows work to proceed. Verified facts: `AUTO_RANDOM` is supported but only on a clustered BIGINT primary key and cannot be added or removed by `ALTER`; foreign keys are enforced and GA from v8.5.0 and new Starter clusters default to v8.5.3; **CHECK constraints are disabled by default** (`tidb_enable_check_constraint`) and TiDB silently ignores a CHECK added with `ADD COLUMN`; `SELECT ... SKIP LOCKED` and `FULLTEXT` are listed as unsupported except Starter in certain AWS regions; vector search is public preview with HNSW and TiFlash; backups on free Starter are daily with one-day retention, no point-in-time restore, no manual backup [V].
- **Why it matters:** An untested assumption in the data layer is the most expensive kind to discover late. Several v1.0 statements ("also as CHECK constraints", "versioning", least-privilege DB users) may be false on the chosen instance.
- **Correction:** v1.1 §11.20 (matrix of every feature, verified behaviour, assumption, test ID, fallback) and gate S-3 (§9). Schema is marked "provisional" until S-3 passes. Fallbacks: application-generated IDs behind an `IdGenerator`, application-side validation, n-gram search, own export for backups, a single SQL user with compensating controls, or another MySQL-compatible host.
- **Owner approval:** Only if a fallback requires a different or paid database.
- **Validation:** Gate S-3, run against a real Starter instance and a local TiDB container.

#### RF-004 — Accuracy gates cannot be demonstrated with the specified dataset
- **Severity:** Critical. **Affected:** §1.4, §13.8, §23.2, §26 Phase 1 acceptance.
- **Description:** 150 documents (100 development, 50 held-out) with gates such as precision ≥ 0.95, `high`-confidence precision ≥ 0.99, abstention ≥ 0.98, and "blocked if any metric drops more than 1 percentage point". §1.4 also states "≥ 99% after human review".
- **Why it matters:** My calculation (§7.D): 48/50 gives a 95% Wilson interval of [0.865, 0.989]; the 95% half-width at n = 50 is about ±6 points, so a 1-point regression test is noise. Showing a precision lower bound of 0.95 at an observed 0.99 needs about 110 instances; showing 0.98 needs about 189 error-free instances; claiming at most 1% error needs about 299 error-free instances. Critical fields are not present in every document, so per-field counts are far below 50.
- **Correction:** v1.1 §13.8 defines development, validation and held-out test splits split by organisation or template family, per-stratum quotas, field-instance counting, Wilson intervals, paired tests for regressions, a production audit sample, and acceptance criteria stated as interval bounds. "99% after review" becomes a monitored target, not a claim.
- **Owner approval:** Yes (annotation capacity, UQ-8).
- **Validation:** Gates S-2 and S-4 (pilot, feasibility only), then the gold-set build and audit sampling plan.

#### RF-005 — Deletion, consent, retention, backups and AI history contradict each other
- **Severity:** Critical. **Affected:** US-08, §11.3 (`user_consents`), §11.11, §11.12, §11.19, §15.9, §19.5 journey 20, O-05, O-06.
- **Description:** §15.9 retains consent proof "anonymised" yet `user_consents.user_id` is NOT NULL and the row retains for 3 years; journey 20 asserts "no rows or objects referencing the user remain". `ai_processing_jobs.user_id` has no foreign key, so cascade deletion misses it; `ai_usage_ledger.user_id` (13 months), `product_events.user_id`, `user_reports.reporter_id` (24 months), `audit_logs.actor_id`, `circulars.created_by`, `opportunity_documents.uploaded_by`, per-page transcripts and pasted URLs all outlive or sidestep deletion. Backups keep deleted data up to six months with no replay mechanism. The cancel-by-login grace period conflicts with revoked sessions.
- **Why it matters:** The Personal Data Protection Ordinance 2025 is reported to require consent, subject rights and cross-border care [V-sec]; whatever the exact legal text, the system must be able to say precisely what it deletes, what survives and why.
- **Correction:** v1.1 §15.9 (deletion matrix by table and object, state machine, retry and verification, partial-failure handling), §11.21 (new tables: `consent_events`, `deletion_requests`, `deletion_steps`, `deletion_ledger`, tombstone columns), backup replay in §9.13 and gate S-11. Consent proof design: pseudonymous `subject_ref`, no email stored, optional keyed verifier, retention period left to counsel.
- **Owner approval:** Yes (retention periods and legal position, UQ-5, UQ-17).
- **Validation:** Gate S-11 and E2E journeys 20 and 35, with journey 31 for export and journey 30 for consent withdrawal (v1.1 §19.5).

#### RF-006 — Upload lifecycle lacks states, size enforcement and gating
- **Severity:** Critical. **Affected:** §15.6 (SEC-20 to SEC-27), §12.2 (`/uploads/presign`), §11.9, B-01 to B-03, O-01 to O-07.
- **Description:** There is no upload record, no "upload complete" step, and `user_documents.validation_status` has only `pending|passed|rejected`. v1.0 says the presigned signature "binds content type and maximum size", but R2 supports presigned GET, HEAD, PUT and DELETE only; POST policy (the mechanism that carries `content-length-range`) is **not supported**; the R2 page says a signed `Content-Type` is enforced but states nothing about `Content-Length` [V/NF]. Nothing guarantees the pipeline cannot read an object before validation.
- **Why it matters:** An attacker (or a buggy client) can upload large or hostile objects, and the AI pipeline could process unvalidated content.
- **Correction:** v1.1 §15.6: upload states and transitions, a **separate quarantine bucket** with a write-and-validate-only credential that the AI and download modules do not hold, a completion endpoint with `HEAD` verification, pending-upload quotas, expiry sweeper plus lifecycle rule (R2 lifecycle rules support expiry by days, prefix filters and aborting incomplete multipart uploads [V]), resource-limited sandboxed parsing, and safe download rules.
- **Owner approval:** Cloudflare account (payment-method requirement for R2 not found [NF]); UQ-19.
- **Validation:** Gate S-8 including a hostile-file suite and an enforcement experiment for signed `Content-Length`.

#### RF-007 — Transactional email undefined and unvalidated for P0 flows
- **Severity:** Critical. **Affected:** §4.1 (email channel P1), F-04, §8.2 (registration, verify, reset), §12.2 auth endpoints, §24.1 Email row, §29.2 UQ-10, UQ-14, §26 Phase 2.
- **Description:** Verification, reset and security emails are P0 but there is no requirement set, no provider decision grounded in evidence, no authentication, bounce or retry design, and the roadmap places "email provider integration" in Phase 2. v1.0 recommended Brevo "for the higher daily cap" on the basis of a secondary source; Brevo's free limits could not be confirmed from official pages [NF]. The default `EMAIL_DAILY_CAP=250` exceeds Resend's verified free limit of 100/day.
- **Why it matters:** If email fails, nobody can register or recover an account. A 100/day cap is exhausted by about 50 to 90 sign-ups plus resets.
- **Correction:** v1.1 Module F2 (EM-01 to EM-14), §9.15, domain authentication (SPF and DKIM required; DMARC starting at `p=none`), reserved quota for security mail, bounce and complaint handling, suppression list, retry, registration throttle when the cap is near, provider interface with Resend primary and Amazon SES fallback.
- **Owner approval:** Yes (provider account, domain purchase, any paid plan).
- **Validation:** Gate S-7 (header checks, inbox placement across providers, webhook processing, quota behaviour).

#### RF-008 — Phase 0 spikes are tasks, not gates
- **Severity:** Critical. **Affected:** §26 Phase 0, §27.2.
- **Description:** S-1 to S-5 and DS-1 have no procedure, thresholds, failure conditions or fallbacks, and Phase 1 does not depend on them. Scheduler reliability, email delivery, upload security and deployment configuration have no spike at all.
- **Why it matters:** Untested critical assumptions can invalidate Phase 1 work already done.
- **Correction:** v1.1 §26.1 defines S-1 to S-11 plus DS-1 as pass/fail gates with objective, hypothesis, procedure, environment, expected result, acceptance criteria, failure conditions, fallback, evidence and owner-approval flag; and a dependency rule (§9.3 below).
- **Owner approval:** Yes for the resources each spike creates.
- **Validation:** Each gate's saved evidence package; Phase 1 task list references gate IDs.

### High

#### RF-009 — Job-claim SQL cannot reclaim expired locks
- **Severity:** High. **Affected:** §9.7 JOB-1, §19.4 ("lock expiry reclaim").
- **Description:** The claim statement filters `status IN ('queued','retry')` but a crashed worker leaves `status = 'running'`. The prose says expired locks are reclaimed; the SQL never matches them. `ORDER BY priority, run_at` also does not match index `ix_bj_claim (status, run_at, priority)`.
- **Why it matters:** A job abandoned by a restart is stuck forever; reminders and email would silently stop.
- **Correction:** v1.1 JOB-1 adds `OR (status='running' AND locked_until < NOW(3))`, a bounded `attempts` check, a heartbeat column, a corrected index, and a concurrency test (20 workers, 10,000 jobs, each processed exactly once in effect).
- **Owner approval:** No. **Validation:** Integration test plus gate S-3 and S-6.

#### RF-010 — No graceful shutdown, heartbeat or at-least-once contract
- **Severity:** High. **Affected:** §9.7, ADR-006.
- **Description:** Render sends SIGTERM and, after the shutdown delay (default 30 seconds, configurable up to 300 seconds [V]), SIGKILL; free instances also spin down without documented signal handling [V/NF]. v1.0 sets a five-minute lock with no heartbeat and says handlers are idempotent, but no contract exists for what happens to the in-flight job.
- **Why it matters:** Duplicate or lost side effects (emails, notifications, AI spend).
- **Correction:** v1.1 SCH-04 to SCH-09: stop claiming on SIGTERM, finish or release within `maxShutdownDelaySeconds`, return interrupted jobs to `retry` without consuming an attempt, heartbeat every 60 seconds extending a 3-minute lease, stage checkpoints for AI jobs, and side-effect idempotency keys.
- **Owner approval:** No. **Validation:** Gate S-6 (SIGTERM and SIGKILL 20 times mid-run).

#### RF-011 — Reminders lack catch-up semantics after downtime
- **Severity:** High. **Affected:** F-02, §9.7.
- **Description:** v1.0 skips a reminder "whose time has already passed when created" but defines nothing for a reminder that became due during an outage.
- **Why it matters:** Deadline reminders are the product's core promise to the people who use it; a user who misses a deadline because the server was restarting loses an opportunity, and a duplicate or silently skipped reminder erodes trust.
- **Correction:** v1.1 SCH-10: materialise by watermark; send a late reminder if within a grace window (default 6 hours, never after the deadline), otherwise skip and write a `missed` audit event; always compute the next offset.
- **Owner approval:** No. **Validation:** Test with simulated six-hour outage (gate S-6).

#### RF-012 — CI and local development use MySQL 8 while the schema is TiDB-specific
- **Severity:** High. **Affected:** §19.1, §21.2 `ci.yml`, ADR-014, §9.12.
- **Description:** MySQL 8 does not support `AUTO_RANDOM` or `VECTOR`, so the migrations cannot apply; v1.0's workaround is a different ID strategy locally, which means CI would test a different schema from production.
- **Why it matters:** A CI suite that cannot apply the production schema, or that applies a different one, gives false assurance; defects in `AUTO_RANDOM`, foreign-key or queue behaviour would first appear in production.
- **Correction:** v1.1: local and CI use a TiDB container pinned to the Starter default version (v8.5.x at the access date), nightly against a real Starter instance; `IdGenerator` interface retained as the documented fallback.
- **Owner approval:** No. **Validation:** Gate S-3 and a CI job that applies migrations from scratch on the pinned TiDB image. Whether a suitable container image and its single-node mode are available was not verified [RV].

#### RF-013 — Roadmap and cost scenarios contradict the P0 scope
- **Severity:** High. **Affected:** §4.1, §24.2, §26 Phase 1 and 2.
- **Description:** Email integration is in Phase 2 but registration needs it in Phase 1. The "zero-spend prototype" lists "no features that send personal data to AI" yet the user-facing analyzer (P0) can receive personal data. Phase 1 also lists the Analyzer without a paid-AI dependency.
- **Why it matters:** An implementing agent following the roadmap would build registration without any way to send the verification email, or would discover mid-phase that the analyzer needs a paid configuration the scenario says is not needed.
- **Correction:** v1.1 moves transactional email to Phase 1; defines the zero-spend setup as staff-only analysis of public documents; adds UQ-18 and states that user-uploaded analysis requires the paid configuration or is disabled.
- **Owner approval:** Yes (UQ-3, UQ-18). **Validation:** Roadmap dependency table check (v1.1 §26).

#### RF-014 — Gemini logging, retention, Contributor tier and EEA terms missing
- **Severity:** High. **Affected:** §13.1, §13.3, §24.1, SEC-46.
- **Description:** Facts read from official pages [V]: paid prompts are not used to improve products except under the Contributor tier; abuse-monitoring retention is 55 days with human review only by authorised Google employees; developer logs default to a maximum of 55 days (configurable to 7, 14, 28 or 55) and are on by default for `generateContent` in projects created on or after 2026-10-26; Files API files are stored for 48 hours; content may be stored or cached in any country; paid status requires a Cloud project with an active billing account; for users in the EEA, Switzerland and the UK only paid services may be used; zero data retention, data-residency guarantees and an explicit "no human review" statement for paid content were not found [NF].
- **Why it matters:** The privacy notice, retention design and consent text depend on what the provider keeps and for how long; unstated defaults (logging on for new projects, 55-day retention, Contributor tier) would make those documents inaccurate.
- **Correction:** v1.1 §13.9 and gate S-10: set developer-log retention to the minimum, never enrol in the Contributor tier, send documents inline (no Files API), disclose Google's retention in the privacy policy, and restrict AI access for users in the EEA, UK and Switzerland to the paid configuration. The logs-policy details came from a single delegated read and are re-verified in the S-10 console check.
- **Owner approval:** Yes (UQ-3, UQ-21). **Validation:** Gate S-10.

#### RF-015 — Backup and restore rest on an unvalidated path
- **Severity:** High. **Affected:** §9.13 Backup, §11.19, `backup.yml`, RK-21.
- **Description:** Free Starter has daily backups, one-day retention, no point-in-time restore and no manual backups; restore goes to a new instance and does not restore credentials [V]. v1.0's own export runs from a GitHub runner, but whether a runner can reach the Starter endpoint, how long an export of a given size takes, and how deleted users are re-deleted after a restore were never specified. R2 has no object versioning [V], contrary to "versioning where available".
- **Why it matters:** One-day retention without point-in-time restore means a bad migration or deletion bug discovered after a day is unrecoverable from the provider alone, and a restore could resurrect deleted users.
- **Correction:** v1.1: the provider backup is a convenience, the encrypted logical export is the primary recovery path; `deletion_ledger` replay after any restore; restore drill with measured times; key custody as an owner decision.
- **Owner approval:** Yes (key custody, UQ-20). **Validation:** Gate S-11.

#### RF-016 — No consent management schema or API
- **Severity:** High. **Affected:** §11.3 `user_consents`, COMP-2, §12.2, §8.3 Settings.
- **Description:** COMP-2 says withdrawing consent must be as easy as giving it, but there is no endpoint, the purpose list lacks `ml_training`, `ai_processing_uploaded_circulars` and `submit_for_publication`, and the current-state view is not derivable.
- **Why it matters:** Consent that cannot be withdrawn, or that services never actually check, is not consent; the AI privacy policy depends on consent purposes being enforced server-side.
- **Correction:** v1.1 CON-01 to CON-08, `consent_events` (append-only) plus a `consent_state` view, `GET/POST /me/consents`, purpose registry with defaults (all optional purposes off).
- **Owner approval:** Counsel review of wording (UQ-5). **Validation:** Integration and E2E journey 30.

#### RF-017 — "Submit for publication" has no data path
- **Severity:** High. **Affected:** §3.4, `POST /circulars/analyses/{id}/submit`, §11.7, N-01.
- **Description:** A private analysis references `user_documents`; publication needs an `opportunity_documents` row, a `circulars` row and evidence. There is no description of copying or re-validating the file, user consent for it, what remains after the submitter deletes their account, or how a malicious submission is handled.
- **Why it matters:** Publication is the highest-risk path in the product (a wrong or malicious listing harms many users); its data flow, consent and deletion consequences must be explicit rather than inferred.
- **Correction:** v1.1 B-22 to B-26: explicit consent at submit time; only extracted facts and a staff-held copy of the document move across; the submitter reference is a pseudonymous token; deleting the account never removes verified published facts but removes the submitter link.
- **Owner approval:** Counsel (UQ-4). **Validation:** E2E journey 32.

#### RF-018 — Tables referenced but not defined
- **Severity:** High. **Affected:** §9.8 (`search_suggestions`), §12.1 (idempotency), §12.2 (`/me/export`), §8.3, §9.15.
- **Description:** No DDL for search suggestions, idempotency records, data exports, email suppressions, upload sessions or deletion tracking; `user_projects`, `certifications` and `user_languages` exist only as comments.
- **Why it matters:** An implementing agent would have to invent these tables, risking inconsistent designs and gaps in deletion and retention.
- **Correction:** v1.1 §11.21 provides DDL for all of them.
- **Owner approval:** No. **Validation:** Schema review and migration test.

#### RF-019 — Idempotency-Key semantics without storage
- **Severity:** High. **Affected:** §12.1, B-21.
- **Description:** §12.1 says a repeated `Idempotency-Key` returns the original response within 24 hours but defines no place to keep the response, no behaviour for a changed body, and no behaviour for a request still running.
- **Why it matters:** Double-submitted analyses and exports would spend AI budget twice and create duplicate records; without storage the promise cannot be implemented.
- **Correction:** v1.1 `idempotency_keys` table (key, user, route, request hash, response snapshot, expiry 24 hours), rule that a reused key with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.
- **Owner approval:** No. **Validation:** Integration tests (double submit, retry after timeout).

#### RF-020 — Monitoring depends on the process being awake
- **Severity:** High. **Affected:** §9.13 Monitoring and Alerts, §22.5.
- **Description:** "Last tick > 30 min ago" and error-rate alerts are produced by the API itself. TiDB Starter has no built-in alerting [V]. Sentry's free Developer plan includes one cron monitor and one uptime monitor [V].
- **Why it matters:** If the process that raises alerts is the process that failed, nobody is told; reminders could stop for days unnoticed.
- **Correction:** v1.1 SCH-12: an external dead-man check (Sentry cron monitor and uptime monitor, plus the scheduler's failure notification) alerts when ticks stop; scheduler tools like cron-job.org disable a job after more than 25 consecutive failures and give no punctuality guarantee [V], so an independent alert path is mandatory.
- **Owner approval:** No (free tiers). **Validation:** Gate S-6 (stop ticks, alert within twice the interval).

#### RF-021 — Free-instance resources conflict with budgets and workloads
- **Severity:** High. **Affected:** §16.2, §16.3 Memory, SEC-22, SEC-23, §9.9 Argon2id.
- **Description:** Free instances have 0.1 CPU and 512 MB; the legacy "Starter" compute plan has 0.5 CPU and 512 MB [V]. p95 latency targets, Argon2id hashing, PDF parsing and image re-encoding were budgeted without these numbers.
- **Why it matters:** Performance and memory targets that cannot be met on the hosting actually used lead to silent removal of security controls under pressure.
- **Correction:** v1.1 states which environments the budgets apply to (E1 and E2 only), adds measured-resource gates in S-8 and S-9, and lowers the image decode cap (RF-030).
- **Owner approval:** Yes if a larger instance is needed. **Validation:** Gates S-6, S-8, plus k6 on staging.

#### RF-022 — Cost and provider facts stale or wrong
- **Severity:** High. **Affected:** §24.1, §24.2, §29.2 UQ-10, UQ-13, UQ-14, §29.3.
- **Description:** Corrections now verified [V]: Sentry free plan retains 30 days (v1.0 said 14); GitHub Free includes US$12 of Actions compute per month for private repositories (v1.0 said unverified); R2 free tier confirmed, payment-method requirement not found; Turnstile requires a Cloudflare account; Vercel Pro is US$20 per developer seat with a US$20 credit; Vercel Hobby cron runs at most once per day with ±59 minute precision; Resend free is 100/day and 3,000/month with one webhook endpoint and no SLA listed. Brevo's free limits are not verifiable from official pages [NF]. UQ-13 asks whether a keep-alive is acceptable (answered: do not do it) and UQ-10 recommends an unverified provider.
- **Why it matters:** The owner makes spending decisions from this section; wrong figures or an unverifiable recommendation would mislead those decisions.
- **Correction:** v1.1 §24 rewritten; UQ-10 and UQ-13 replaced.
- **Owner approval:** Yes for every paid line. **Validation:** Re-read provider pages at account creation; record in `docs/versions.md`.

### Medium

#### RF-023 — CHECK constraints are off by default
- **Severity:** Medium · **Affected:** §11.15
- **Description:** v1.0 says value rules are enforced "also as CHECK constraints". TiDB disables CHECK unless `tidb_enable_check_constraint` is on and ignores a CHECK added with `ADD COLUMN`; whether Starter enables it is not documented [V/NF].
- **Why it matters:** A silently ignored constraint gives false assurance about data integrity.
- **Correction:** v1.1 DBC-03: application validation is authoritative; CHECK is optional defence in depth.
- **Owner approval:** No.
- **Validation:** Gate S-3 test T-04.

#### RF-024 — `AUTO_RANDOM` specifics and ID strategy drift
- **Severity:** Medium · **Affected:** §11.1, ADR-014
- **Description:** The primary key must be a clustered BIGINT; composite keys only if the `AUTO_RANDOM` column is first; explicit inserts need `allow_auto_random_explicit_insert`; the (5, 54) form keeps values JSON-safe; it cannot be added by `ALTER` [V]. v1.0's local fallback used different IDs.
- **Why it matters:** Retrofitting an ID strategy later requires a table rebuild; divergent local IDs hide bugs.
- **Correction:** v1.1 DBC-01: `AUTO_RANDOM(5, 54)`, IDs remain strings in JSON, `IdGenerator` fallback.
- **Owner approval:** No.
- **Validation:** Gate S-3 tests T-01, T-02.

#### RF-025 — Full-text search is a public preview and Bengali support is unconfirmed
- **Severity:** Medium · **Affected:** §9.8, ADR-008
- **Description:** Starter-only, five AWS regions (Oregon, N. Virginia, Tokyo, Frankfurt, Singapore), "still in the early stages", BM25 ranking; Bengali analyser and phrase matching not documented [V/NF].
- **Why it matters:** Search quality for Bangla is a core user need; a preview feature may change or fail on Bangla text.
- **Correction:** v1.1 gate S-1 with the n-gram fallback fully specified; Singapore selected as the region.
- **Owner approval:** Only if an external search service is needed.
- **Validation:** Gate S-1.

#### RF-026 — SQL users and privileges on Starter unconfirmed
- **Severity:** Medium · **Affected:** SEC-35, §11.12 `audit_logs`, §11.16
- **Description:** The security-settings page states it does not apply to Starter, and no page confirmed multiple SQL users or table-level grants [NF].
- **Why it matters:** The "append-only audit log" and "no DDL for the runtime user" controls may be impossible as written.
- **Correction:** v1.1 DBC-06 and SEC-35: compensating controls (single user, `appendAudit()`-only code path, lint ban, off-database audit copy).
- **Owner approval:** No.
- **Validation:** Gate S-3 test T-12.

#### RF-027 — Connection pool lifetime and idle settings
- **Severity:** Medium · **Affected:** §11.18
- **Description:** v1.0 sets a 25-minute maximum lifetime; TiDB documents a 340-second idle timeout on public endpoints (TCP keep-alive does not help) and recommends starting at a 5-minute maximum lifetime [V].
- **Why it matters:** Stale connections cause intermittent query failures that are hard to diagnose.
- **Correction:** v1.1: lifetime 5 minutes, idle below 300 seconds, reconnect on error for idempotent statements.
- **Owner approval:** No.
- **Validation:** Gate S-3 test T-13 (one-hour soak).

#### RF-028 — Vercel proxied-request timeout and client-IP assumptions
- **Severity:** Medium · **Affected:** §9.2, §9.9, S-5
- **Description:** Vercel's maximum proxied-request timeout is 120 seconds [V] while a cold Render free start takes about a minute [V]. The API sees Vercel's addresses, so IP-based rate limits and `ip_hash` depend on a trusted forwarded address; cookie forwarding through rewrites was not documented [NF].
- **Why it matters:** Wrong client IPs disable rate limiting; lost cookies break login.
- **Correction:** v1.1 SEC-37 (edge secret), pre-session CSRF, S-5 tests and a documented sibling-subdomain alternative.
- **Owner approval:** No.
- **Validation:** Gate S-5.

#### RF-029 — DOCX allowed in the vault though scanning is a precondition
- **Severity:** Medium · **Affected:** O-04, SEC-21, SEC-26
- **Description:** O-04 allows DOCX while SEC-26 says a scanner must exist before DOCX or sharing.
- **Why it matters:** Two requirements that cannot both be satisfied produce an unsafe compromise during implementation.
- **Correction:** v1.1: vault allow-list PDF, JPEG, PNG only until a scanner exists.
- **Owner approval:** No.
- **Validation:** Upload tests (§19.4).

#### RF-030 — 40-megapixel image limit is unsafe on a 512 MB instance
- **Severity:** Medium · **Affected:** SEC-23
- **Description:** 40 MP at four bytes per pixel is about 160 MB for one decoded image.
- **Why it matters:** A single hostile image could exhaust memory and crash the process.
- **Correction:** v1.1 UP-09: 16 MP cap set in the decoder, one validation job at a time, memory measured in S-8.
- **Owner approval:** No (a larger instance is an owner decision only if measurements fail).
- **Validation:** Gate S-8.

#### RF-031 — API route inconsistencies
- **Severity:** Medium · **Affected:** Modules D, E, F; §12.2
- **Description:** Module F says `GET /me/calendar.ics?token=` but §12 says `GET /calendar/{token}.ics`; Module E says `/cvs/{id}/export` but §12 says `/me/cvs/{id}/export`; Module D says `POST /opportunities/{id}/feedback` but §12 says `PUT/DELETE …/feedback/{signal}`; `GET /me/export` starts a job.
- **Why it matters:** Frontend and backend implementers would build different routes from the same plan.
- **Correction:** v1.1 aligns module cards to §12; export starts with `POST`.
- **Owner approval:** No.
- **Validation:** Route-table consistency script (§12 of this report).

#### RF-032 — API gaps: endpoints, error codes, rate limits
- **Severity:** Medium · **Affected:** §12.1, §12.2
- **Description:** Missing upload completion and status endpoints, consent endpoints, deletion status and cancel, export retrieval; missing error codes (`UPLOAD_NOT_VALIDATED`, `UPLOAD_EXPIRED`, `UPLOAD_REJECTED`, `AI_DATA_POLICY_BLOCKED`, `CONSENT_REQUIRED`, `ACCOUNT_PENDING_DELETION`, `IDEMPOTENCY_KEY_REUSED`, `REGISTRATION_PAUSED`) and rate limits for presign, verification, resend, consent writes.
- **Why it matters:** The new flows cannot be implemented or tested without them; unlimited endpoints are abuse vectors.
- **Correction:** v1.1 §12 additions and examples.
- **Owner approval:** No.
- **Validation:** Contract tests and rate-limit tests.

#### RF-033 — CSRF for unauthenticated state-changing endpoints
- **Severity:** Medium · **Affected:** §9.9, §12.1
- **Description:** The CSRF token is "bound to the session" but login, registration, reset and reports have no session.
- **Why it matters:** Login CSRF and forced actions on public forms remain possible.
- **Correction:** v1.1: signed pre-session token in a `__Host-` cookie, double-submitted, plus the Origin check.
- **Owner approval:** No.
- **Validation:** Security test that omits the token on every public POST.

#### RF-034 — Navigation shows destinations that are not in the MVP
- **Severity:** Medium · **Affected:** §8.1, §8.3, §8.4
- **Description:** Calendar, Documents, CVs and drafts and Compare appear in navigation while F-07, Module O, Module E and J-01 are P1.
- **Why it matters:** Dead-end journeys in a trust-focused product.
- **Correction:** v1.1 phase-gated navigation rule with feature flags.
- **Owner approval:** No.
- **Validation:** Per-phase E2E link crawl.

#### RF-035 — Tracker row loses its identity when an opportunity is removed
- **Severity:** Medium · **Affected:** §11.8 `application_records`
- **Description:** `ON DELETE SET NULL` leaves a record with no title.
- **Why it matters:** Users lose their own application history.
- **Correction:** v1.1 snapshot columns copied at creation (G-02).
- **Owner approval:** No.
- **Validation:** Integration test removing an opportunity.

#### RF-036 — Automatic "reported" state is gameable
- **Severity:** Medium · **Affected:** L-04
- **Description:** Three anonymous reports could flip a genuine listing's state.
- **Why it matters:** Competitors or trolls could suppress real opportunities.
- **Correction:** v1.1: only distinct verified accounts at least 7 days old (or a verified organisation) count; anonymous reports only queue.
- **Owner approval:** No.
- **Validation:** Unit test with a sock-puppet scenario.

#### RF-037 — Test-plan gaps
- **Severity:** Medium · **Affected:** §19.4, §19.5, §19.8
- **Description:** No journeys for password reset, verification expiry, consent withdrawal, export, upload rejection, scheduler outage recovery or deletion with partial failure; journey 20's "no row remains" conflicts with retained pseudonymous records; CI database mismatch (RF-012).
- **Why it matters:** New critical requirements would ship untested.
- **Correction:** v1.1 journeys 29 to 36, revised journey 20, new suites and fixtures.
- **Owner approval:** No.
- **Validation:** CI runs the suites; checklist §19.10.

### Low

#### RF-038 — Stale cross-references
- **Severity:** Low · **Affected:** §2.1, A-08, US-03, §15.3
- **Description:** §17.6 cited for JobPosting policy (correct: §17.3); §16.4 cited for limits (correct: §16.2); §19.9 cited for failure-path tests (correct: §19.8).
- **Why it matters:** An agent following a wrong reference reads the wrong section.
- **Correction:** Fixed in v1.1; automated reference check.
- **Owner approval:** No.
- **Validation:** Cross-reference script.

#### RF-039 — Stale `reminders` table reference
- **Severity:** Low · **Affected:** Module F "Required data"
- **Description:** Lists `reminders`; §11.10 states there is no such table.
- **Why it matters:** An agent could create a redundant table that must be rewritten on every deadline change.
- **Correction:** Removed in v1.1.
- **Owner approval:** No.
- **Validation:** Table-name check against DDL.

#### RF-040 — Field-name mismatch
- **Severity:** Low · **Affected:** C-02 and §11.7
- **Description:** C-02 names `condition`; the DDL has `activation_condition`.
- **Why it matters:** API and database field names would diverge.
- **Correction:** Aligned to `activation_condition`.
- **Owner approval:** No.
- **Validation:** Contract test.

#### RF-041 — API example inconsistencies
- **Severity:** Low · **Affected:** §12.3
- **Description:** The eligibility example's summary counts two passing rules but shows one; the list example filters `category=government` while the slug is `government-job`.
- **Why it matters:** Examples are copied into tests and clients.
- **Correction:** Fixed; examples to be generated from schemas in CI.
- **Owner approval:** No.
- **Validation:** Contract tests.

#### RF-042 — Foreign-key DDL missing for some tables
- **Severity:** Low · **Affected:** §11.7, §11.8, §11.4
- **Description:** Join tables and `application_documents` lack FK clauses although a comment says "FK cascade"; three profile tables exist only as comments.
- **Why it matters:** Orphan rows and incomplete deletion.
- **Correction:** DDL provided in v1.1.
- **Owner approval:** No.
- **Validation:** FK-target script and nightly orphan check.

#### RF-043 — ER diagram incomplete
- **Severity:** Low · **Affected:** §11.2
- **Description:** Core tables only; `ai_extraction_results }o--o| circulars` is unclear.
- **Why it matters:** Readers may assume omitted tables are unimportant.
- **Correction:** Diagram extended for new tables; a script lists tables absent from it.
- **Owner approval:** No.
- **Validation:** Script output in §12.

#### RF-044 — Queue index order
- **Severity:** Low · **Affected:** §11.12
- **Description:** `ix_bj_claim (status, run_at, priority)` versus `ORDER BY priority, run_at`.
- **Why it matters:** The claim query may scan more rows than necessary.
- **Correction:** Index `(status, priority, run_at)`.
- **Owner approval:** No.
- **Validation:** `EXPLAIN` in gate S-3.

#### RF-045 — Marigold chip boundary contrast
- **Severity:** Low · **Affected:** §6.4, §7.5
- **Description:** I recomputed `marigold-500` against `paper-50` at 2.06:1, below the 3:1 non-text threshold; text on it (`ink-900`, 7.61:1) is fine.
- **Why it matters:** The chip shape would be hard to see for low-vision users.
- **Correction:** Chips carry a text label and a 1 px `ink-900` border; all other v1.0 contrast figures were confirmed.
- **Owner approval:** No.
- **Validation:** Token contrast test in CI.

#### RF-046 — R2 versioning statement
- **Severity:** Low · **Affected:** §9.13 Backup
- **Description:** "versioning enabled where available"; R2 has no versioning [V].
- **Why it matters:** A reader could assume deleted objects are recoverable.
- **Correction:** Removed; recoverability comes from backups, and deletion is final.
- **Owner approval:** No.
- **Validation:** S-8 deletion test.

#### RF-047 — Missing MFA enrolment and recovery flows
- **Severity:** Low · **Affected:** §9.9, §8.3, T-01
- **Description:** Admin TOTP is mandatory but enrolment, recovery codes and lost-device reset are unspecified; user TOTP is mentioned without a requirement.
- **Why it matters:** Admins could be locked out or left with weak recovery.
- **Correction:** v1.1 AUTH-MFA-01 to AUTH-MFA-04 and a Security page.
- **Owner approval:** No.
- **Validation:** E2E journey 21 extended; unit tests for recovery codes.

#### RF-048 — Table-of-contents link does not match its heading
- **Severity:** Low · **Affected:** §0 table of contents, §22
- **Description:** The contents entry "Admin and operations" links to `#22-admin-and-operations`, but the heading is "22. Admin and operational systems", so the link resolves to nothing (found by the anchor check in §12).
- **Why it matters:** Readers and agents following the contents list land nowhere for that section.
- **Correction:** v1.1 links the entry to `#22-admin-and-operational-systems`.
- **Owner approval:** No.
- **Validation:** Anchor-resolution script (§12): all 32 internal links in v1.1 resolve.

#### RF-049 — Unescaped pipe characters break eight table rows
- **Severity:** Low · **Affected:** §5 Module E API row, §11.13 later-phase tables (three rows), §12.1 Language and Pagination rows, §13.4 `ocr.transcribe.v1` row, §17.2 Title row
- **Description:** A `|` inside a table cell (even inside a code span) is read as a column separator, so those rows render with extra columns and misplaced text. The table check found 8 such rows in v1.0 and 1 more was introduced and fixed during v1.1 drafting.
- **Why it matters:** The affected rows hold API formats, schema enumerations and the SEO title template; a misrendered row can be misread by the implementing agent.
- **Correction:** Pipes escaped as `\|` in v1.1.
- **Owner approval:** No.
- **Validation:** Table column-count script (§12): 188 tables, 0 mismatches in v1.1.

**Totals:** Critical 8 · High 14 · Medium 15 · Low 12 · **49**.

---


## 7. Detailed analysis of the seven mandatory issues

### A. Render free tier and the background scheduler

**What v1.0 does.** Fastify API on Render, a database-backed job table, an in-process worker, and an external tick every 10 minutes.

**What the official pages say (fetched 2026-11-13 [V]).**
- Free web services, static sites, Postgres and Key Value exist; workers and cron jobs have no free plan. "Free instances have important limitations … Do not use them for production applications."
- A free web service spins down after 15 minutes without inbound traffic (HTTP requests and WebSocket messages). It spins up on the next HTTP request or WebSocket connection, about one minute later. "Render might restart a Free web service at any time." Local filesystem is lost on spin-down, restart and redeploy.
- 750 free instance hours per workspace per month; spun-down time does not consume them; when hours run out all free web services in the workspace are suspended until next month.
- A free service that initiates an "uncommonly high volume" of public-internet traffic may be suspended; examples named include accessing an external database, invoking external APIs and transferring data to or from external object storage.
- Cron jobs cost a minimum of US$1 per month per service and are billed per second; a run is stopped after 12 hours. Workers have no free tier. Singapore is an available region.
- On deploy or restart: SIGTERM, then SIGKILL after the shutdown delay (default 30 seconds, configurable to 300 seconds).
- **Not found:** the Terms of Service and Acceptable Use bodies (only navigation text was returned), the Starter plan price, and any official statement on whether health checks or uptime pings keep a free service awake.

**Answers to the questions asked.**

| Question | Answer |
|---|---|
| Is the proposed design permitted by current Render policies? | **Not shown to be.** No prohibition was found in the pages I could read, but the Terms and AUP bodies were unavailable, and the free page forbids production use. A scheduler that exists to keep the instance awake is exactly the pattern to avoid. Treat as not permitted for production. |
| Does it create unexpected hosting costs? | Not on free (no card). Indirectly: it consumes nearly all 750 hours with one service, so a second free service (for example staging) suspends all of them when hours run out. The real cost is the forced move to a paid instance later, under pressure. |
| What happens when the instance sleeps or restarts? | In-process state, loaded caches and unfinished work are lost (filesystem loss is documented; in-memory loss is inherent). The first request after sleep takes about a minute and must not time out a Vercel proxied request (limit 120 seconds [V]). |
| Can jobs be missed? | Jobs in the table are not lost, but they are **delayed**, and v1.0's claim SQL cannot reclaim a job left `running` by a killed process (RF-009). Periodic work without a catch-up rule is skipped (RF-011). |
| Are retries and recovery reliable? | Retry/backoff is specified; recovery is not, because of RF-009, RF-010. |
| Is execution idempotent? | Notification and delivery keys are specified; stage-level checkpoints for AI jobs and side-effect keys for email were not. |
| Do deadlines and notifications remain reliable? | Public deadline display is reliable (computed at read time). Reminders are only as reliable as the scheduler; on a free instance they are best-effort. |

**Recommended design (v1.1 §9.7, §9.14).**

| Setup | Purpose | Hosting | Scheduler | Guarantees | Cost |
|---|---|---|---|---|---|
| **E0 — free, dev/test/closed alpha** | Developing and testing; invited testers who understand delays | Render free web service; Vercel Hobby; TiDB Starter; R2 | Manual trigger, GitHub Actions `workflow_dispatch`, optional schedule **no more often than every 30 minutes** so the instance sleeps between runs | None. Reminders and email are best-effort. No real user may depend on them. **Do not tick at 15 minutes or faster.** | US$0 (service accounts as owner approves) |
| **E1 — production** | Real users | Render **paid always-on web service** (price to be verified by the owner); in-process scheduler with a database lease | In-process loop every 5 minutes with `scheduled_tasks` watermark; external tick (cron-job.org or GitHub Actions) as a redundant trigger and dead-man switch | At-least-once jobs; reminders within the interval plus grace window | Instance price (owner-verified) |
| **E2 — hardened production** | Frequent restarts or stricter reminder timing | E1 plus a **Render Cron Job** running the tick script | Platform-owned cron | Independent of API process health | E1 plus at least US$1 per month per cron job [V] |

On E0 with a 60-minute tick the instance is awake for roughly 16 minutes per tick, about 27% of the month, which is about 200 hours and within 750 [A arithmetic]; this is a consequence of real sleeping, not a mitigation to defeat it.

**Job reliability rules** (SCH-01 to SCH-12): lease with heartbeat, graceful SIGTERM handling, stage checkpoints, per-side-effect idempotency keys, reminder watermark and grace window, external dead-man alert. Validation: gate S-6.

### B. Gemini privacy and the AI data-classification policy

**Provider facts [V, official pages read via a fetch helper on 2026-11-13; terms effective 2026-03-23].**

| Topic | What the official pages say |
|---|---|
| Unpaid services | Free quota and direct AI Studio use are "Unpaid Services". Google may use submitted content to "provide, improve, and develop Google products and services and machine learning technologies". "Human reviewers may read, annotate, and process your API input and output." "Do not submit sensitive, confidential, or personal information to the Unpaid Services." |
| Paid services | "Paid" means access through a Cloud project with an active billing account. Google "doesn't use your prompts … or responses to improve our products". Exception: the Contributor tier uses unpaid-style terms. |
| Retention (paid) | Abuse-monitoring data kept 55 days; human review of that data only by authorised Google employees. Developer logs default maximum 55 days (7, 14, 28 or 55 configurable); on by default for `generateContent` in projects created on or after 2026-10-26. |
| Files API | Files stored for 48 hours; 20 GB per project; 2 GB per file; PDF requests 50 MB. |
| Location | Data "may be stored transiently or cached in any country in which Google or its agents maintain facilities". |
| Processor terms | Paid prompts fall under the "Data Processing Addendum for Products Where Google is a Data Processor" (link in the terms; **not read**). |
| EEA, UK, Switzerland | "You may use only Paid Services when making API Clients available to users in the European Economic Area" (and Switzerland and the UK). |
| Age | 18 or older. |
| **Not found** | Zero data retention; data-residency guarantee; context-cache retention period; an explicit "no human review" statement for paid content. |

I did not rely on any statement about a provider's privacy practice that was not on an official page above. The Gemini processor addendum, any Bangladesh cross-border implications, and the legal sufficiency of this setup are for counsel.

**Policy (v1.1 §13.9).** Four AI configurations: **CFG-N** no AI (deterministic code), **CFG-F** Gemini unpaid (a Cloud project with no billing account), **CFG-P** Gemini paid (billing active, logging minimised, no Contributor tier), **CFG-L** self-hosted model (future).

| # | Data category | Class | Permitted configuration | Restrictions | Required safeguards |
|---|---|---|---|---|---|
| 1 | Public opportunity circulars (staff-sourced from official publications) | DC-A | CFG-F or CFG-P | Source recorded as public official; no user-supplied extras in the prompt | Provenance tag `public_official`; metadata-only logging; budget and quota |
| 2 | Public website content (staff-pasted URLs or approved sources) | DC-A | CFG-F or CFG-P | Only SRC-1-approved hosts or staff-entered URLs | SSRF controls; robots/terms rules; provenance tag |
| 3 | Anonymous application questions (free text from visitors) | DC-B | **CFG-P only**, or feature disabled | Length cap 500 characters; PII screen (emails, phone numbers, ID patterns) rejects or reclassifies; no storage of the text beyond a 24-hour dedupe hash | Rate limit; CAPTCHA-class bot control; never CFG-F because free text cannot be guaranteed free of personal data |
| 4 | User profile information | DC-C | **CFG-P only** | Only fields needed for the feature; never date of birth, gender or district unless the feature requires it; **eligibility never uses AI** | Consent `ai_processing_personal` per feature; notice of what is sent; retention below |
| 5 | CVs and resumes | DC-C | **CFG-P only** | Sent inline (no Files API); explicit user action each time | Consent `ai_processing_personal`; anti-fabrication checks; AI input not stored by us beyond the job |
| 6 | Uploaded personal documents (transcripts, certificates, vault files) | DC-D | **Blocked in MVP.** Later: CFG-P only with per-document consent | No identity documents ever | Per-document consent event; enable only after S-10 and counsel review |
| 7 | Contact information (user's emails, phones, addresses) | DC-D | **Never sent.** Redacted to placeholders before any prompt and re-inserted afterwards | Official contact details inside DC-A documents are public and allowed | Redaction layer with tests; canary strings in CI |
| 8 | Sensitive application information (application IDs, payment details, notes, exam and interview details, identity numbers) | DC-E | **Prohibited for every configuration** | Gateway rejects with `AI_DATA_POLICY_BLOCKED` | Type system makes the call impossible; audit event on attempt |
| 9 | User-uploaded circulars (private analysis) | DC-C (may contain personal data) | **CFG-P only** | Reclassifiable to DC-A only by staff after verifying it is a public official document | Consent `ai_processing_uploaded_circulars` at first use; 30-day file retention |
| 10 | Staff-uploaded official documents | DC-A | CFG-F or CFG-P | Source documented | As row 1 |
| 11 | AI outputs | Inherit the highest class of inputs | Stored per class | — | Deleted with the source |
| 12 | Evaluation datasets | DC-A only | CFG-F or CFG-P | No user data in evaluation | Gold set outside the public repository |

**Enforcement (cannot be bypassed by feature code).**
1. Only the `ai` module may read provider credentials; two key variables (`GEMINI_API_KEY_FREE`, `GEMINI_API_KEY_PAID`) are read only inside `ai/providers/`.
2. ESLint `no-restricted-imports` bans the provider SDK and a CI grep bans provider host strings outside the gateway; a bypass test tries a direct call from a feature module and must fail the build.
3. Inputs are built only through typed constructors (`pub()`, `usr()`, `sens()`); untagged strings are a type error. The gateway computes the **highest class across all variables and attachments** itself; the caller does not declare it.
4. A policy table (class × configuration) lives in code and is versioned in `system_settings`; a 100% unit matrix test covers every cell.
5. If the permitted configuration is unavailable (no paid key, budget exhausted, outage), the request is **blocked** (`AI_DATA_POLICY_BLOCKED` or `AI_BUDGET_EXHAUSTED`) or falls back to an approved alternative: rule-only extraction for digital PDFs, or queuing the document for staff manual entry. It is never downgraded to a less private configuration.
6. Logging: ledger rows hold feature, model, configuration, class, token counts, cost, latency, outcome and a request hash. Never prompt text, document text or model output. A canary-string test checks logs, error reports and the ledger.
7. Kill switch: `system_settings.ai.enabled_configs`.

**Consent, retention and disclosure.** Consent purposes: `ai_processing_uploaded_circulars`, `ai_processing_personal`, `submit_for_publication`, `ml_training` (default off). AI job metadata 180 days; private-analysis transcripts and uploads 30 days unless the user keeps them (deleted with the account); model outputs follow their source. The privacy policy must disclose the provider, the 55-day abuse-monitoring retention, the configured developer-log retention, cross-border processing and that Google may store content in any country; counsel decides adequacy.

### C. TiDB and MySQL compatibility

**Verified facts [V, docs.pingcap.com, 2026-11-13].** Gaps are marked [NF].

| Feature | What the documentation says | Plan assumption in v1.0 | Result |
|---|---|---|---|
| `AUTO_RANDOM` | Since v3.1.0; **BIGINT clustered primary key only**; composite key allowed if it is the first column; hashed shard bits (default 5), range configurable; "JSON number" safe range note recommends `AUTO_RANDOM(5, 54)`; explicit insert needs `allow_auto_random_explicit_insert`; cannot be added or removed with `ALTER`. MySQL 8 does not implement it (not stated in the docs; known). | Used for every table; local MySQL fallback IDs | Keep, with `AUTO_RANDOM(5, 54)`; local/CI must be TiDB (RF-012); `IdGenerator` fallback |
| Foreign keys | Supported and enforced by default; GA since v8.5.0; may reduce performance; changing FKs via `ALTER` needs checks disabled; not on temporary or partitioned tables, nor BLOB/TEXT columns. New Starter clusters default to v8.5.3 (note dated 2026-02-10); the version of an existing instance is [NF]. | "Verified in S-3" | Test T-02; nightly orphan check stays |
| CHECK | Supported but **disabled by default**; ignored when added with `ADD COLUMN`. Whether Starter enables it [NF]. | "also as CHECK constraints" | Application validation authoritative; CHECK optional |
| UNIQUE | Standard; multiple NULLs permitted in unique keys (standard MySQL semantics; test confirms). | Used widely | Test T-04 |
| Transactions | Pessimistic by default; snapshot isolation advertised as REPEATABLE-READ; READ COMMITTED only in pessimistic mode; 100 MB transaction, 6 MB row; Starter: transactions ≤ 30 minutes | Short transactions | Keep; add write-conflict retry (T-05) |
| `SELECT … SKIP LOCKED` | **Not supported** | v1.0 avoided it | Keep avoidance; queue claim validated under concurrency |
| JSON | Supported with listed differences (for example MySQL rejects integer inserts into JSON; ordering differences); a field is indexed through a generated column | JSON for rule params, snapshots | Test T-07 |
| FULLTEXT | Starter only, regions: Oregon, N. Virginia, Tokyo, Frankfurt, Singapore; public preview; BM25; Bengali/phrase [NF] | Candidate search | S-1 gate |
| Vector | Public preview on Starter; HNSW; fixed dimension; no PK/unique use; relies on TiFlash | P2 only | Defer; re-verify at P2 |
| Triggers, stored procedures, events, UDFs | Not supported | Not used | OK |
| Index key length | 3072 bytes default | `VARCHAR(300)` unique keys fine | Test T-09 |
| Collation | `utf8mb4_bin` default | Explicit `*_normalized` columns | OK |
| Backups | Free Starter: daily, 1-day retention; no PITR; no manual backups; restore to a new instance without credentials; Export (SQL, CSV, Parquet) and `mysqldump`/Dumpling exist | Provider backups with own export | Own export is primary (RF-015) |
| Connections | TLS 1.2/1.3 only; 400 concurrent (5,000 with spending limit); 340 s idle timeout on public AWS endpoint; 30-minute lifetime; recommended max lifetime start 5 minutes | 25-minute lifetime | Change (RF-027) |
| Privileges | Multi-user grants on Starter [NF] | Separate runtime and migration users | T-12; fallback single user |
| Drizzle / mysql2 | No official guide found [NF] | Used | T-10 |
| Local development | TiDB runs as a single-node container [A, not verified] | MySQL 8 container | Pin and test (RF-012) |

**Phase 0 database compatibility test plan** (gate S-3; full procedure in v1.1 §26.1 and §11.20). Tests T-01 to T-14: `AUTO_RANDOM` creation, insert, returned IDs through `mysql2` and Drizzle, range below 2^53; FK violation, cascade and `ON DELETE SET NULL`; CHECK behaviour and variable state; unique and composite keys with Bangla values and NULLs; pessimistic transaction conflicts and retries; queue claim with 20 concurrent workers and 10,000 jobs (each exactly once); JSON round-trip and indexed generated column; keyset pagination under concurrent inserts; key-length limits; Drizzle migrations forward from empty and expand/contract changes touching FKs; SQL users and grants; one-hour connection soak with recycle; Request-Unit measurement for list, search and publish transactions; backup visibility, restore to a scratch instance and export/import round trip.

**Pass:** every "must" test passes or has an owner-approved fallback recorded in an ADR. **Fallbacks:** application-generated IDs; application validation without CHECK; n-gram search; own export as primary backup; single SQL user with compensating controls; or another MySQL-compatible managed database if Starter is unsuitable overall. The schema stays **provisional** until S-3 passes.

### D. Extraction evaluation and accuracy

**Is 150 documents (100 development, 50 held-out) enough?** For some purposes yes (finding catastrophic failures), for the proposed gates no.

| Scenario | Wilson 95% interval |
|---|---|
| 48/50 correct | [0.865, 0.989] |
| 50/50 correct | [0.929, 1.000] |
| 190/200 | [0.910, 0.973] |
| 297/300 | [0.971, 0.997] |
| 990/1000 | [0.982, 0.995] |

| To show … | Instances needed |
|---|---|
| precision lower bound ≥ 0.95, if the true rate is 0.99 | about 110 |
| precision lower bound ≥ 0.95, if the true rate is 0.97 | about 414 |
| `high`-confidence precision lower bound ≥ 0.98 with no errors | about 189 |
| error rate ≤ 1% at 95% confidence with no errors observed | about 299 |
| error rate ≤ 0.5% | about 598 |

At 50 documents the 95% half-width for an estimate near 0.95 is about 6 points, so "blocked if any metric drops more than 1 point" cannot be evaluated. Critical fields are not all present in every document (fee, exam date, start date appear in a minority), so per-field counts are well under 50. The held-out set would also have to be touched on every tuning decision for a 1-point rule to bind.

**v1.1 evaluation design (§13.8).**
- **Datasets:** Phase 0 pilot of 30 documents (feasibility only, no accuracy claims); then a gold set grown to at least 400 documents: **development** 150 (prompt and parser iteration), **validation** 100 (model/prompt selection and confidence thresholds), **held-out test** 150 (frozen; evaluated once per release candidate; 30% refreshed if peeking is suspected). Splits are by **issuing organisation or template family**, not random, to prevent leakage.
- **Strata (minimums in the test split where possible, otherwise reported with the actual n):** scanned PDFs, poor-quality phone images, 10-plus-page circulars, multi-position circulars, corrigendum/update pairs, table-heavy layouts, mixed Bangla-English, legacy-font PDFs, English-only.
- **Units:** field instances, not documents; each metric reports numerator, denominator and Wilson interval.
- **Annotation:** two annotators plus adjudication; agreement reported per critical field (target κ ≥ 0.85, otherwise the guidelines are revised). Annotation effort is an owner capacity question (UQ-8).

| Metric | Definition | Acceptance (pre-review pipeline, held-out test) |
|---|---|---|
| Field-level precision | Correct stated values ÷ stated values, pooled over critical fields | Point ≥ 0.95 **and** Wilson lower bound ≥ 0.92 (needs several hundred instances) |
| Field-level recall | Correct stated values ÷ values present | ≥ 0.90 point estimate (informational for safety; affects review time) |
| Evidence validity | Stated fields whose quote is on the stated page | Point ≥ 0.97, lower bound ≥ 0.95 |
| High-confidence precision | Precision among fields labelled `high` | Lower bound ≥ 0.97 with at least 200 instances; fewer instances means "not demonstrated" and 100% human confirmation continues (already required) |
| Confidence calibration | Precision per confidence bin; reliability table | `high` ≥ `medium` ≥ `low` ordering holds with non-overlapping intervals; report only otherwise |
| Abstention correctness | Absent fields output as `stated:false` | Lower bound ≥ 0.95 over at least 100 absent-field instances |
| OCR quality | Character and word error rates on 60 transcribed pages stratified by quality; **digit-sequence error rate** for dates and amounts | Digit-sequence accuracy ≥ 0.98 on good and fair pages; for poor pages, wrong-OCR **detection** recall ≥ 0.90 |
| Deadline extraction | Exact date match; date-plus-time match; abstention; corrigendum extensions; per-position deadlines | Point ≥ 0.97, lower bound ≥ 0.93 on at least 150 deadline instances; **zero** high-confidence wrong deadlines or the release is held for root-cause analysis |
| Eligibility extraction | Rule-level exact and semantic match (rule type and parameters); end-to-end status agreement on 40 synthetic profiles × 30 circulars with human-labelled outcomes | Rule precision ≥ 0.90, recall ≥ 0.85 pre-review; **zero** false "Eligible" outcomes in the end-to-end check |
| Position segmentation | F1 on multi-position circulars | ≥ 0.90 with interval reported (n ≥ 40) |
| Regression | Paired comparison on the same items (exact McNemar) plus intervals | A release is held for a statistically supported degradation on any gated metric or any new silent critical error |

**Production safety does not rest on these numbers.** Critical fields are always confirmed by a person. After launch, an **audit sample** (random 5% of published critical field instances, at least 300 instances in a rolling window) is independently re-checked; "≤ 1% published critical-field error" is a monitored target, reported with its interval, never a launch claim. "99% accuracy" must not appear in product or marketing text. Difficult categories (scanned, poor images, long, multi-position, corrigenda, tables, mixed script, legacy PDFs) each get a per-stratum report; strata with fewer than 30 test instances are reported but not gated except for "no silent critical error".

### E. Account deletion, consent and retention

**What contradicted what in v1.0.** Listed under RF-005. The design below resolves it.

**What is deleted, anonymised, retained.**

| Data | Action on account deletion | Notes |
|---|---|---|
| Account, profile, education, experience, skills, projects, certifications, languages, test scores, preferences | **Delete** (hard) | Cascades from `users` |
| Sessions, auth tokens, OAuth links, MFA secret | **Delete** | |
| Saved items, feedback, views, eligibility results | **Delete** | |
| Applications, checklists, status history, notes, encrypted application references | **Delete** | |
| Notifications, preferences, delivery records | **Delete** | Provider-side logs expire per provider (Resend free keeps 30 days [V]) |
| Vault files, analysis uploads, transcripts, CVs, drafts, generated documents | **Delete** objects first, then rows | Registry of object keys per user (`file_objects`); orphan sweep as backstop |
| `ai_processing_jobs`, results, extraction fields for private analyses | **Delete** | Add FK with cascade (RF-005) |
| `ai_usage_ledger.user_id` | **Anonymise** (set NULL) | Cost totals retained |
| `product_events` rows with a user | **Delete** | Aggregates in `metrics_daily` contain no identifiers |
| `user_reports.reporter_id`, reporter IP hash | **Anonymise** (NULL) | Report text kept only if it concerns a listing and contains no personal data; free-text screened |
| `audit_logs` entries where the deleted user is the **target** | **Anonymise** (NULL target, strip metadata) | Entries where a **staff** user is the actor are retained (accountability); staff offboarding is a separate procedure [counsel] |
| Published opportunities and versions created from the user's submission | **Retain** (public facts) | Submitter link replaced by a pseudonymous token; the private source file is deleted unless the publication copy was staff-verified and retained as the official source copy |
| Consent proof | **Retain pseudonymised** | See below; period is a counsel decision |
| Email suppression (bounce/complaint/unsubscribe) | **Retain** as a keyed hash of the address | Needed to honour opt-outs; [counsel] |
| Backups | **Age out** | Replay ledger on restore |
| Gemini (processor side) | Not deletable by us | Abuse-monitoring 55 days; developer logs per configured retention; disclosed in privacy policy; Files API avoided |

**Consent proof without unnecessary identification.** `users.consent_subject_ref` is a random 128-bit value generated at registration. `consent_events` (append-only) stores `subject_ref`, purpose, granted, policy version, timestamp, and the interface locale. It does **not** store email or name. At deletion the `users` row is removed, leaving `subject_ref` unlinked. Optionally (counsel decision UQ-17) a `deleted_subjects` row stores `HMAC(key, normalised email)` so that a later claim by a person who supplies their email can be checked without holding the email. Retention of `consent_events` after deletion is a placeholder (v1.0's three years) until counsel decides the period and whether the keyed verifier is lawful and proportionate.

**Workflow (v1.1 §15.9).** `requested` → 7-day grace (login allowed only to a cancel screen with a restricted session) → `executing` (steps recorded in `deletion_steps`, each idempotent: objects, rows by dependency order, anonymisations, email suppression hash, provider notifications) → `verifying` (checker queries every table in the deletion registry for the user ID and lists the bucket registry) → `completed`; on any failure `partial`: access stays closed, the job retries with backoff for up to 72 hours (maximum 10 attempts), then raises an admin alert with a manual runbook; completion target 30 days maximum [placeholder pending counsel]. `deletion_ledger` stores only the numeric user ID and timestamps (no personal data) and is kept at least as long as the longest backup (nine months). **After any backup restore, the ledger is replayed before the service reopens.**

**Prohibited claims.** The privacy notice must not claim immediate erasure from backups or from the AI provider; it states the windows above. Anything about statutory retention, breach notification, cross-border transfer and children is flagged for counsel.

### F. Secure file uploads

**State machine (v1.1 §15.6).**

| State | Meaning | Who can access the object |
|---|---|---|
| `initiated` | Presign issued, expires in 5 minutes; per-user pending limit applies | Uploader (write only, via signed URL) |
| `uploaded` | Client called `/uploads/{id}/complete`; server `HEAD` confirmed size equals the declared size and is within limit, and content type matches | Upload-validator only (quarantine credential) |
| `validating` | Worker holds a lease; sandboxed parse, type check, hashing, re-encoding | Upload-validator only |
| `validated` | Sanitised object copied to the private bucket under a new random key; quarantine copy deleted; `user_documents` row created with `validation_status = passed` | Application and AI pipeline (private credential), owner by presigned GET |
| `rejected` | Reason code recorded; quarantine object deleted within 1 hour | None |
| `expired` | Not completed in 15 minutes, or not validated within 24 hours; swept | None (deleted) |
| `deleted` | Removed by user, retention or account deletion; row keeps no content | None |

Allowed transitions: `initiated → uploaded | expired`; `uploaded → validating | rejected | expired`; `validating → validated | rejected`; `validated → deleted`; `rejected → (object removed)`; no transition leaves `rejected` or `expired` except removal. **A file is invisible to the AI pipeline and to download until `validated`.** The quarantine bucket is separate and its credential is held only by the upload-validator module, so the AI and download modules physically cannot read quarantined objects (per-bucket token scoping is [RV in S-8]).

**Controls.**
- **Size:** per-type limits (PDF 10 MB, image 8 MB, vault 10 MB). R2 presigned URLs: PUT supported; POST policy not supported; a signed `Content-Type` is enforced; `Content-Length` enforcement is not documented [V/NF]. So: bind `Content-Type`, also include `Content-Length` in signed headers and test whether R2 enforces it (S-8), **always** `HEAD` at completion, delete anything over limit, cap pending uploads per user, expire quickly, and apply a quarantine lifecycle rule as a backstop (lifecycle rules support expiry by days, prefix filters and aborting incomplete multipart uploads; deletion may take up to 24 hours [V]). Residual risk: bytes written between upload and sweep, bounded by quotas and monitored.
- **Types:** allow-list PDF, JPEG, PNG, WebP (circulars); vault adds nothing new until a scanner exists. Magic bytes checked; client MIME ignored.
- **PDF parsing:** worker thread with memory and time limits; no JavaScript, launch actions or embedded files; encrypted PDFs rejected; page and per-page pixel caps; one validation job at a time per instance.
- **Images:** decode with a hard pixel cap (**16 MP**, about 64 MB decoded, replacing the unsafe 40 MP) and re-encode.
- **Malware:** no antivirus daemon on a 512 MB instance. MVP: strict allow-list, re-encoding, no execution, attachment-only downloads, deny-list of rejected hashes; staff view pages as server-rasterised images or sandboxed PDF viewer, never raw PDFs in the main origin [RV in S-8]. Upgrade trigger: DOCX, sharing between users, or staff opening user files directly → paid scanner before enabling.
- **Download:** ownership and `validated` check, 60-second presigned GET, `Content-Disposition: attachment`, no inline serving from the application origin; keys are random; IDOR tests for every route.
- **Deletion:** objects deleted before rows; R2 lacks versioning so deletion is final [V]; nightly reconciliation between bucket listing and registry.

### G. Transactional email

**Verified data [V unless marked].**

| Provider | Free tier | Restrictions and notes | Paid entry |
|---|---|---|---|
| **Resend** (`resend.com/pricing`, quotas page) | 3,000 emails/month, **100/day**; 3 domains; **1 webhook endpoint**; 30-day data retention; ticket support; SPF/DKIM/DMARC supported | Rate limit 10 requests/s; account paused if spam rate stays above 0.08% (and bounce rate is expected under 4%); daily and monthly quota errors return 429; no SLA on free (only listed for Enterprise) | Pro US$20/month for 50,000 emails; overage US$0.90 per 1,000; no daily limit on Pro |
| **Amazon SES** | No ongoing free allowance found (new-account credit of up to US$200 for six months mentioned); à la carte US$0.10 per 1,000 outbound | New accounts start in a **sandbox**: 200 messages per 24 hours, 1 per second, verified recipients only; production access request answered by AWS Support "within 96 hours"; you confirm you handle bounces and complaints | Pay as you go |
| **Postmark** | 100 emails/month on the free Developer plan, "no overages allowed" | Intended for testing and low-volume side projects | Basic US$15/month for 10,000 |
| **Mailgun** | 100 emails/day, 1 custom domain, 1-day log retention, ticket support | Monthly cap not shown | From US$15/month |
| **Brevo** | **Not verifiable from official pages** (pricing page is script-only, help article returned 403, product page 404) [NF] | v1.0's "300/day" came from secondary sources only | — |

Google's sender requirements: all senders to Gmail need SPF or DKIM; senders of more than 5,000 messages a day also need DMARC (policy `none` is acceptable) and one-click unsubscribe for marketing mail; keep the reported spam rate below 0.10% and never reach 0.30%; valid PTR and TLS [V].

**Recommendation.**
- **Primary: Resend** behind the `EmailProvider` interface, because its limits are verified, it has webhook support, and its Pro plan removes the daily limit. **Free plan is for development, test and closed alpha**; public launch with real users needs a paid plan or SES (an owner decision, because free tiers list no SLA and a 100/day ceiling blocks sign-ups).
- **Fallback: Amazon SES**, requesting production access **early** (96-hour response) so the fallback is ready; it also needs verified identities and bounce handling via its own notification mechanism (the SNS wiring was not documented on the pages read [NF]).
- **Not recommended until verified:** Brevo.
- **Quota arithmetic on the free plan:** each sign-up consumes at least one email (verification), a reset consumes one, resends consume more; at 100/day, roughly 50 sign-ups plus support traffic exhaust the cap. v1.1 therefore **reserves** 60% of the daily cap for security mail, throttles registration (`REGISTRATION_PAUSED`) before the cap is reached, never sends digests on a free plan, and queues rather than drops security mail.

**Domain, authentication and operations (v1.1 EM-01 to EM-14).** Send from a dedicated subdomain; SPF and DKIM must align before any production sending; DMARC begins at `p=none` with aggregate reports, tightened after a clean period; one-click unsubscribe headers on digests; no tracking pixels; plain-text part; retry 1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours; 4xx permanent errors suppress the address; hard bounce and complaint webhooks update `email_suppressions`; soft bounces pause after three; webhook signatures verified.

**Account creation, domain purchase and any paid subscription are owner decisions (UQ-6, UQ-10, UQ-16).** Gate S-7 measures delivery before any real user signs up.

---

## 8. Cross-section consistency audit (v1.0)

| Area | Result | Findings |
|---|---|---|
| Product and requirements | Mostly consistent. Every module has IDs and acceptance criteria. Gaps: transactional email, consent management, upload and deletion requirements. MVP boundary is clear except email. | RF-007, RF-013, RF-016, RF-034 |
| Architecture | Responsibilities clear; hosting, scheduler and failure strategies incomplete for Render, email, object storage, Gemini. | RF-001, RF-010, RF-020, RF-021, RF-028 |
| Database | Relationships coherent; many tables lack deletion semantics; several referenced tables missing; naming and FK gaps. | RF-003, RF-005, RF-018, RF-035, RF-040, RF-042, RF-043, RF-044 |
| API | Mostly consistent; route mismatches; missing endpoints, errors and limits. | RF-031, RF-032, RF-033, RF-019 |
| AI | Validation, evidence and human review are strong; data policy and evaluation weak. AI cannot create opportunities without verifier approval (confirmed). | RF-002, RF-004, RF-014 |
| Security | OWASP 2025 category mapping **verified accurate** (A01 includes SSRF; A03 supply chain failures; A10 mishandling of exceptional conditions; names match `top10.owasp.org/2025`). Upload and deletion incomplete. | RF-006, RF-005, RF-029, RF-030 |
| Frontend and UX | States defined; navigation lists non-MVP items; MFA enrolment missing. | RF-034, RF-047 |
| Testing | Broad; CI database mismatch and journey gaps. | RF-012, RF-037 |
| Deployment and operations | Env vars documented; rollback exists; free-tier restrictions ignored in places; monitoring depends on the monitored process. | RF-001, RF-015, RF-020 |
| Cost | Stale or unverified entries; invalid recommendations. | RF-013, RF-022 |

**Mechanical checks performed** (scripts and a Mermaid parser; what each checked, the results and the limits are in §12). The cross-section findings in this table come from reading the whole plan; the scripts confirmed or located several of them.

### Findings by master-plan section

| v1.0 section | Findings |
|---|---|
| 1 Vision and principles | RF-004 (1.4), RF-002 (new principles) |
| 2 Research | RF-001, RF-002, RF-003, RF-038 (stale refs) |
| 3 Users and stories | RF-005 (US-08), RF-038 (US-03) |
| 4 Scope | RF-007, RF-013 |
| 5 Modules | RF-007, RF-016, RF-017, RF-029, RF-031, RF-034, RF-036, RF-038, RF-039, RF-040 |
| 6–7 Brand and design | RF-045 |
| 8 Navigation and pages | RF-034, RF-047 |
| 9 Architecture | RF-001, RF-009, RF-010, RF-011, RF-015, RF-020, RF-028 |
| 10 ADRs | RF-001 (003, 006), RF-002 (009), RF-003 (005, 008, 014) |
| 11 Database | RF-003, RF-005, RF-018, RF-023 to RF-027, RF-035, RF-040, RF-042 to RF-044 |
| 12 API | RF-019, RF-031 to RF-033, RF-041 |
| 13 AI | RF-002, RF-004, RF-014 |
| 14 ML | No findings (consent purpose `ml_training` added through RF-016) |
| 15 Security | RF-005, RF-006, RF-026, RF-029, RF-030, RF-033, RF-038 |
| 16 Performance | RF-021 |
| 17 SEO | RF-038 |
| 18 Accessibility | RF-045, RF-047 |
| 19 Testing | RF-012, RF-037 |
| 20 Workflow | No findings |
| 21 GitHub/CI | RF-012 |
| 22 Admin | RF-005 (deletion monitoring) |
| 23 Analytics | RF-005 |
| 24 Cost | RF-013, RF-022 |
| 25 Deployment | RF-001, RF-007, RF-022 |
| 26 Roadmap | RF-008, RF-013 |
| 27 Checklists | RF-008 |
| 28 Risks | RF-001 (RK-10, RK-15), RF-002 (RK-08) |
| 29 Assumptions and decisions | RF-022 (UQ-10, UQ-13, UQ-14) |
| 30–31 Glossary, references | RF-022 |

## 9. Phase 0 validation gates

Phase 0 must become a real gate. Full procedures, evidence lists and thresholds are in **v1.1 §26.1**. Summary:

| ID | Gate | Hypothesis | Core pass criteria | On failure | Owner approval |
|---|---|---|---|---|---|
| S-1 | Bangla/English search quality | TiDB full-text or the n-gram table meets search targets | bn-query recall@10 ≥ 0.90 on a labelled 200-query set; p95 ≤ 500 ms at 50k synthetic rows; ≤ 100 RU per query average [A target] | Choose n-gram fallback; if both fail, external search service decision | Only if external service |
| S-2 | OCR quality and legacy-font PDFs | Gemini OCR and the heuristic meet digit-accuracy and detection targets | Digit-sequence accuracy ≥ 0.98 on good/fair pages; poor-page detection recall ≥ 0.90; legacy-font detection ≥ 0.95 with false positives ≤ 5% | Two-pass consensus; cross-check engine; manual transcription for scanned documents | Corpus handling and effort |
| S-3 | TiDB compatibility | Schema, queue and migrations behave on Starter | Tests T-01 to T-14 pass or each has a recorded fallback | Fallbacks per §7.C | If a different or paid DB |
| S-4 | Gemini extraction (pilot) | Pipeline v0 is workable | Pilot pooled critical-field accuracy ≥ 0.85 point estimate with no systematic failure class; first-pass schema validity ≥ 97%; ≤ US$0.05 per document p95; ≤ 120 s p95 for ≤ 10 pages | Escalate model; otherwise redefine Module B as assisted manual entry | Yes (AI budget) |
| S-5 | Deployment topology | Vercel rewrite to Render preserves cookies, headers, client IP; cold start tolerated | Login and CSRF flow work via rewrite; client IP correct for rate limiting; public pages render with API asleep; first response after sleep ≤ 90 s | Subdomain with `__Secure-` cookie and CORS; Node proxy route | No |
| S-6 | Scheduler and job reliability | Jobs survive kills; reminders catch up; no keep-alive needed | Zero lost jobs and zero duplicate side effects across 20 SIGTERM and 20 SIGKILL runs; reminders caught up after simulated 6-hour outage; dead-man alert within 2× interval; E0 awake-hours projection ≤ 360 h/month at ≥ 30-minute ticks | Production on E1/E2 only | Yes (paid instance for E1/E2) |
| S-7 | Transactional email | Provider delivers and authenticates | SPF/DKIM aligned; 100% of 50 test messages across Gmail, Outlook, Yahoo and one Bangladeshi mailbox delivered; no spam foldering in Gmail and Outlook; p95 delivery ≤ 120 s; bounce webhook updates suppression; quota logic holds | Switch to SES; paid plan | Yes (domain, accounts, plan) |
| S-8 | Object storage and upload security | State machine and controls hold on R2 | Hostile-file suite fully rejected without crash; peak memory ≤ 70% of instance; oversize uploads deleted ≤ 1 hour; pipeline credential cannot read quarantine; lifecycle rule observed | API-streamed upload; separate bucket or provider | Yes (account) |
| S-9 | Deployment and environment configuration | A clean clone reaches staging using the README only | Config validation fails on missing env; secret scan clean; migrations run via CD with the migration user; rollback rehearsal ≤ 30 minutes; every env var documented | Fix documentation and scripts | Yes (resources) |
| S-10 | AI data-policy enforcement | Policy cannot be bypassed | Policy matrix 100%; bypass attempts fail the build; zero canary leaks; console shows paid project logging minimised, free project without billing, no Contributor tier | Block AI features | Yes (Gemini projects) |
| S-11 | Backup, restore, deletion propagation | Recovery and deletion work end to end | Restore to a scratch instance succeeds with measured time; ledger replay removes all deleted users; deletion E2E leaves no residual rows or objects; failure injection recovers in ≤ 3 retries | Alternate export path (Render cron, owner machine) | Yes (key custody) |
| DS-1 | Bangla font legibility | Anek Bangla is legible at body size on a low-DPI Android phone | Reviewed samples; chosen body font recorded | Noto Sans Bengali for body | No |

### 9.3 Dependency rule

- **Phase 1 foundation (auth, database, jobs, email, deployment)** may start only after S-3, S-5, S-6, S-7 and S-9 pass or have an owner-approved fallback.
- **Module B and uploads** start only after S-2, S-4, S-8 and S-10.
- **Search** starts only after S-1.
- **Public launch** additionally requires S-11, counsel review, and all owner decisions in §10 marked "before launch".
- A spike marked failed with no recorded fallback blocks every task that depends on it.

## 10. Owner decisions required

Nothing below is decided. A technical recommendation is not owner approval.

| ID | Question | Options | Recommended | Reason | Cost / consequence | Blocked until decided |
|---|---|---|---|---|---|---|
| UQ-1 | Do target users have the stated problems? | Interviews / landing test | 8–10 interviews | Validates D-1 to D-5 | Time | Phase 1 ordering |
| UQ-2 | Commercial status of the launch | Non-commercial on Vercel Hobby; Vercel Pro from day one | Non-commercial; Pro before any revenue | Hobby is non-commercial only; asking for donations is exempt [V] | Pro US$20 per developer seat [V] | Production deploy |
| UQ-3 | Paid Gemini project and monthly cap | None (public-document staff pipeline only); US$10; higher | US$10 hard cap | Personal data needs the paid configuration | Spend | Analyzer for users; Copilot |
| UQ-4 | Re-hosting of official circular files; terms for newspaper-sourced facts | Counsel opinion | No re-hosting until answered | Copyright unknown | Legal fees | Public launch |
| UQ-5 | Data-protection requirements (localisation, registration, consent wording, cross-border) | Counsel opinion | Obtain before launch | Ordinance details only secondary-sourced | Legal fees | Public launch |
| UQ-6 | Domain name | `.com`, `.com.bd`, others | Short `.com` | Email authentication needs a domain | Annual fee | Email gate S-7; staging SEO |
| UQ-7 | Repository licence and visibility | Proprietary/private; Apache-2.0 for pure packages; AGPL; MIT | Private proprietary now | Protects pipeline and data | None | Repository creation |
| UQ-8 | Verification, annotation and moderation capacity | Owner only; volunteers; part-time | Start with two launch categories | Gold-set labelling and verification are labour | People cost | Phase 1 scope; gold set |
| UQ-9 | AI crawlers in robots.txt | Allow; block training; allow search-only | Allow search, block training-only | SEO and control | None | Launch |
| UQ-10 | Email provider (replaces v1.0 Brevo recommendation) | Resend; SES; Postmark; Mailgun | Resend primary, SES fallback | Verified limits and webhooks | Free in alpha; US$20/month Resend Pro or pay-as-you-go SES | Gate S-7 |
| UQ-11 | Bangla copy author and reviewer | Owner; hired reviewer | Fluent reviewer approves all Bangla strings | Quality and trust | Fee | Phase 1 UI |
| UQ-12 | Result-scale equivalences | Per-circular only; adopt an official table | Per-circular first | No official table verified | None | Eligibility engine |
| UQ-13 | (Replaced) Production API hosting plan | Render paid always-on (E1); E1 + cron (E2); another host | E1, add cron if needed | Free is "not for production" [V]; no keep-alive | Instance price (owner-verified) | Production; gate S-6 |
| UQ-14 | (Replaced) Email capacity for launch sign-ups | Free during alpha only; paid plan | Paid plan before public launch | Free 100/day cap | US$20/month (Resend Pro) | Public launch |
| UQ-15 | API hosting spend approval | Approve E1/E2 | Approve E1 | Reliability | Monthly | Gate S-6 (E1) |
| UQ-16 | Email account and any paid plan | — | Create Resend account at S-7 | Evidence before spend | None until paid | S-7 |
| UQ-17 | Consent-proof retention and whether a keyed verifier of the email hash is permitted | Counsel | Counsel decides; default placeholder 36 months pseudonymous only | Legal question | Legal | Deletion implementation finalisation |
| UQ-18 | User-uploaded circular analysis policy | Paid configuration only; disabled until budget; staff-only | Paid only with consent | Free tier forbids personal data | AI spend | Analyzer |
| UQ-19 | Cloudflare account, payment method, bucket plan | R2; other storage | R2 | Free allowance, no egress fee [V]; payment-method requirement not found | Possible card requirement | Gate S-8 |
| UQ-20 | Backup encryption key custody and storage location | Owner offline key; shared secret manager | Owner-held key, tested restore | Loss of key = no recovery | Operational risk | Gate S-11 |
| UQ-21 | Access for users in the EEA, UK and Switzerland | Block; allow with paid-only AI | Allow, paid-only AI | Google terms | Legal | Launch outside Bangladesh |
| UQ-22 | Default for analytics consent | Off until chosen; on with opt-out | Off | Privacy | Less data | Analytics |

## 11. Verified facts and unverified assumptions

### Verified on 2026-11-13 (official pages; some read through a fetch helper)
- Render: free-service behaviour, hours, no free workers or cron, cron minimum US$1, shutdown sequence, regions including Singapore, compute plan CPU and memory — `render.com/docs/free`, `docs/cronjobs`, `docs/compute-plans`, `docs/regions`, `docs/deploys`.
- Gemini: unpaid versus paid terms, abuse-monitoring and developer-log retention, Files API, EEA clause, model and price list (3.5 Flash-Lite and 3.8 Flash; 3.8 Flash price changes on 2027-01-01) — `aistudio.google.com/docs/terms`, `/pricing`, `/models`, `/usage-policies`, `/logs-policy`, `/files`, `/billing`.
- TiDB: items in §7.C — `docs.pingcap.com/tidb/stable/...` and `tidbcloud/...` pages listed in v1.1 §31.
- Cloudflare R2 pricing, presigned-URL support matrix, lifecycle rules, encryption at rest, absence of versioning — `developers.cloudflare.com/r2/...`; Turnstile account requirement.
- Resend, SES, Postmark, Mailgun limits; Google Gmail sender requirements.
- GitHub Actions: US$12 included compute for GitHub Free private use, free standard runners in public repositories; Sentry Developer plan (5,000 errors, 30-day lookback, one uptime and one cron monitor); cron-job.org (free, every minute, 30-second timeout, no punctuality guarantee, auto-disable after more than 25 consecutive failures); Vercel Pro US$20, Hobby cron once per day, regions `sin1` and `bom1`, proxied-request timeout 120 seconds.
- OWASP Top 10:2025 names and order — `top10.owasp.org/2025`.
- Contrast figures in v1.0: recomputed locally; all stated ratios are correct (`ink-900` on `paper-50` 15.68:1, `ink-600` 5.61:1, `line-500` 3.51:1, white on `brand-700` 7.66:1, `ink-900` on `marigold-500` 7.61:1, white on `marigold-500` 2.19:1, white on `success-700` 5.26:1, white on `danger-700` 6.54:1); additional checks: `info-700` text 7.98:1, `brand-700` on `brand-100` 6.24:1, dark theme pairs above 9:1. Only the marigold non-text boundary (2.06:1) fails (RF-045).

### Still unverified (or only secondary)
- Render terms of service and acceptable-use bodies; Render Starter price; whether health checks keep a free service awake.
- Brevo free-plan limits and approval process; Resend and SES behaviour in practice (gate S-7).
- Whether R2 enforces a signed `Content-Length`; whether R2 tokens can be scoped per bucket; whether R2 requires a payment method; R2 lifecycle timing in practice.
- TiDB: Starter's current CHECK setting; multi-user grants; Drizzle/mysql2 guidance; existing-instance version; real RU cost of queries; full-text Bengali support.
- Gemini: paid processor addendum text; zero data retention; context-cache retention; behaviour of the logs policy in the console (single delegated read).
- Bangladesh Personal Data Protection Ordinance details, localisation and breach rules (secondary sources only); copyright of circulars; Bdjobs terms.
- Vercel body-size limit and cookie forwarding through rewrites; whether a pinned TiDB container image runs as a single node for CI.
- Keyword volumes; third-party reports of Gemini free-tier request limits (not official).

## 12. Mechanical checks performed

All scripts ran on 2026-11-13 from a scratch folder outside the project root (Node.js 22; Mermaid 10.9.1 parser with jsdom). They check structure and consistency, not meaning. Heuristics are marked. Nothing was left in the project root except the three deliverable files.

| # | Check | Method | v1.0 result | v1.1 / report result |
|---|---|---|---|---|
| 1 | Fenced code blocks balanced | Script | 72 fences, balanced | v1.1 82 fences, balanced; report has none |
| 2 | Heading hierarchy | Script | One H1, no skipped levels | One H1 and no skipped levels in v1.1 (34 H2) and the report (15 H2) |
| 3 | Internal anchor links resolve | Script | 31 links, **1 unresolved** (`#22-admin-and-operations`, RF-048) | 32 links, all resolve |
| 4 | Mermaid syntax | Mermaid 10.9.1 parser (syntax only; diagrams were **not rendered**) | 12 of 12 parse | 14 of 14 parse |
| 5 | Table column counts (pipes inside cells) | Script | 158 tables, **8 rows with extra columns** (RF-049) | v1.1 188 tables, 0 mismatches; report 18 tables, 0 mismatches |
| 6 | Duplicate requirement IDs (first table column) and ADR IDs | Script | — | None; ADR-001 to ADR-021 unique |
| 7 | Database references | Script | 66 `CREATE TABLE` | v1.1 79 `CREATE TABLE` plus 1 view; 65 foreign-key clauses, **every target is a defined table**; no duplicate table names; every backticked name in "Required data" rows is a defined table; every ER-diagram entity is a table (pseudo-entity `consent_subject` excepted); 30 tables are not drawn in the ER diagram (it remains a core diagram, noted in RF-043) |
| 8 | Route consistency (heuristic) | Script | Four mismatches found by reading (RF-031) | 59 `METHOD /path` routes named in module cards and text; all are present in the §12 tables except `/api/revalidate`, which is a web-app route (§9.13), not API v1 |
| 9 | `§n.m` cross-references resolve to headings | Script | Stale references found (RF-038) | Every reference in v1.1 resolves; no report reference is dangling |
| 10 | Owner decisions | Script | UQ-1 to UQ-14 | UQ-1 to UQ-22 all defined in §29.2, each row with seven fields (question, options, recommendation, reason, consequence, blocked-until); every UQ reference in both documents resolves |
| 11 | Phase 0 gates | Script | — | S-1 to S-11 and DS-1: all ten required fields present in each of the 12 gate specifications |
| 12 | Report ↔ plan consistency | Script plus reading | — | All 49 findings unique and complete (severity, affected section, description, why it matters, correction, owner approval, validation); counts 8 / 14 / 15 / 12; every RF reference in the plan exists in the report; every requirement ID family cited by the report (SCH, EM, CON, B-22 to B-27, SEC-37, AUTH-MFA, DBC) exists in the plan; the gate criteria, hosting setups, quota arithmetic and UQ IDs quoted in the report match the plan (compared by reading and by search) |
| 13 | Phase tags and acceptance criteria (heuristic) | Script plus reading | — | DDL subsections carry phase tags and requirement tables carry priorities and acceptance criteria. The script flagged two **false positives**: `### 11.4 Profile [P0 unless noted]` (a tag is present in an unexpected format) and rows `R-10`…`R-19` (reference-table rows, not requirements) |
| 14 | v1.0 left unmodified | File size | 373,812 bytes, original timestamp | Unchanged |
| 15 | Leftover v1.0 statements | Search | — | No remaining recommendation of the 10-minute keep-alive tick, MySQL 8 in CI, a Brevo recommendation, a caller-declared `dataClass`, or a 14-day Sentry retention outside change-log and prohibition text |

**Not performed:** external URL liveness; rendering of Markdown or Mermaid diagrams; spelling and grammar review; legal review; any experiment on the design itself (those are the Phase 0 gates, §9). Semantic contradictions cannot be fully machine-checked; the two documents were compared by reading the changed sections and by searching for superseded statements.

## 13. Recommended implementation order

1. **Owner decisions needed before Phase 0 spending:** UQ-2, UQ-3 (spike budget), UQ-6, UQ-7, UQ-15, UQ-16, UQ-19, UQ-20. Approve which cloud accounts may be created.
2. **Phase 0, dependency order:** repository and CI skeleton with a pinned TiDB container → **S-3** → **S-9** → **S-5** → **S-6** → **S-7** → **S-8** → **S-10** → **S-2** → **S-4** → **S-1** → **S-11** → DS-1 and brand assets. Run S-3, S-9 and S-7 first because everything else depends on them.
3. **Phase 1A (after S-3, S-5, S-6, S-7, S-9):** auth with email, RBAC, admin shell and audit, reference data, source registry, opportunity model, job queue and scheduler (E1).
4. **Phase 1B (after S-2, S-4, S-8, S-10):** uploads, `AiGateway`, pipeline, review UI, publish flow, search (after S-1).
5. **Phase 1C:** profile, eligibility engine and suite, saved items, reminders, tracker, reports and trust basics, SEO, policies.
6. **Pre-launch:** S-11, counsel review, deletion and export, restore drill, security checklist, owner sign-off.

No time estimates are given.

## 14. Final implementation-readiness checklist

Check each only when evidence exists.

- [ ] Owner has answered UQ-2, UQ-3, UQ-6, UQ-7, UQ-15, UQ-16, UQ-19, UQ-20 (required to start Phase 0)
- [ ] Gates S-3, S-5, S-6, S-7, S-9 passed or fallback approved (required to start Phase 1A)
- [ ] Gates S-2, S-4, S-8, S-10 passed or fallback approved (required to start Module B)
- [ ] Gate S-1 passed (required to start search)
- [ ] Gate S-11 passed (required before public launch)
- [ ] v1.1 §26 roadmap reflects the final gate outcomes
- [ ] Counsel has reviewed privacy policy, terms, source policy, deletion and consent design (UQ-4, UQ-5, UQ-17, UQ-21)
- [ ] Gold set built to the v1.1 §13.8 size and split rules
- [ ] Every Critical and High finding in this report is closed in the plan and verified in code review
- [ ] Production hosting plan chosen (UQ-13/UQ-15) and no keep-alive mechanism exists
- [ ] `docs/versions.md` records exact versions and the date each provider limit was re-read

---

*End of report. Companion plan: `CIRCULAR2ACTION_MASTER_PLAN_v1.1.md`. This is a planning artefact; nothing was implemented, deployed, purchased or pushed.*
