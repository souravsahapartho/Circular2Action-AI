# Architecture decisions

The full ADR table (ADR-001 to ADR-021) lives in `CIRCULAR2ACTION_MASTER_PLAN_v1.1.md` section 10. Copy a row into its own
file `docs/adr/NNN-title.md` when it is first relied on or changed. Deviations made during implementation are recorded here.

## Implementation deviations from the plan

| Date | Deviation | Reason | Revisit when |
|---|---|---|---|
| 2026-11-13 | Workspace scripts use `pnpm -r` instead of Turborepo (ADR-016 names pnpm + Turborepo) | Only four small packages and one app exist; Turborepo adds no value yet | Build times or cache needs justify it |
| 2026-11-13 | pnpm is run through `corepack pnpm@9.15.0` | pnpm was not installed globally on the development machine | A global pnpm is installed |
| 2026-11-13 | Eligibility `language_test` with no matching test in the profile returns `insufficient_information`, not `not_eligible` | Waivers exist; asserting a failure would mislead (PR-3) | Product review of waiver handling |
| 2026-11-13 | Leap-day age convention: Feb 29 attains the year on Feb 28 in common years | A convention is needed; it is not a legal conclusion | Legal confirmation (plan UQ-12) |
