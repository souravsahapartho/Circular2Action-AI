# Gate S-3 — TiDB compatibility

Status: **local and Starter suites pass; T-13 (1-hour soak), T-14 (backup/export round trip) and T-15 (RU table) are not run. Gate NOT yet passed.**

## Environments

| Environment                                                                                             | Version           | State                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| Local container `pingcap/tidb:v8.5.3` (unistore, single node, `docker-compose.yml`)                     | v8.5.3 Community  | All tests below run                                                                                                  |
| Local container `pingcap/tidb:v8.5.8` (first run)                                                       | v8.5.8            | All tests passed, including the single-statement claim                                                               |
| TiDB Cloud Starter `c2a-staging`, AWS ap-southeast-1 (Singapore), $0 spending limit, created 2026-11-13 | v8.5.3-serverless | Full suite run through a DDL user from this machine: 5 files, 34 tests passed (`starter-tidb-v8.5.3-serverless.log`) |

Harness: `apps/api/test-db/*.test.ts`, run with `pnpm --filter @c2a/api test:db` (`TEST_DATABASE_URL`, `TEST_DATABASE_TLS`,
`S3_QUEUE_JOBS`, `S3_QUEUE_WORKERS`). Raw output: `local-tidb-v8.5.8.log`, `local-tidb-v8.5.3.log`, `starter-tidb-v8.5.3-serverless.log`.

## Results (local v8.5.3)

| Test                                                                      | Result                            | Evidence                                                                                                                                              |
| ------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration from empty                                                      | pass                              | 72 tables + `schema_migrations`, 1 view, 59 foreign keys, ~1.2 s                                                                                      |
| Migration idempotent / incremental / checksum guard                       | pass                              | second run applies nothing; `9001_expand` (ADD COLUMN + FK table) applies; edited applied file refused                                                |
| T-01 `AUTO_RANDOM(5, 54)`                                                 | pass                              | 10,000 rows, all unique, max id 8,725,724,278,030,936 < 2^53; `insertId` equals stored id; string round trip                                          |
| T-02 explicit id into AUTO_RANDOM                                         | pass                              | rejected (errno 8216); composite key works                                                                                                            |
| T-03 foreign keys                                                         | pass                              | violation errno 1452; CASCADE and SET NULL work; FK `ALTER` with checks disabled works                                                                |
| T-04 CHECK                                                                | recorded                          | `tidb_enable_check_constraint=OFF`, violation accepted. No CHECK in the DDL; app validation authoritative (DBC-03)                                    |
| T-05 unique                                                               | pass                              | Bangla duplicate errno 1062; two NULLs allowed; Bangla round trip                                                                                     |
| T-06 concurrent updates                                                   | pass                              | 10 workers × 20 increments with `FOR UPDATE` + retry = 200, no lost update                                                                            |
| T-07 queue claim                                                          | see below                         |                                                                                                                                                       |
| T-08 JSON                                                                 | pass (with documented difference) | deep-equal round trip, `JSON_EXTRACT` filter, generated-column index used; **key order not preserved** (`roundTripEqual` on serialised text is false) |
| T-09 collation / key length                                               | pass                              | `utf8mb4_bin`; ZWJ variants stay distinct; key over 3072 bytes rejected (1071)                                                                        |
| `/readyz`                                                                 | pass                              | 200 with DB up; 503 when unreachable or unconfigured                                                                                                  |
| T-11 container parity, T-12 users, T-13 soak, T-14 backup/export, T-15 RU | **not run**                       | need the Starter instance                                                                                                                             |
| T-10 Drizzle                                                              | not applicable                    | Drizzle not used (ADR deviation); plain SQL runner tested instead                                                                                     |

### T-07 queue claim

- Plan statement (`UPDATE ... ORDER BY priority, run_at LIMIT n`): passed 20 workers × 10,000 jobs on v8.5.8
  (10,000 effects, 0 duplicates), but **failed on v8.5.3** with `pessimistic lock retry limit reached`.
- Fallback adopted (ADR-022 in `docs/adr/README.md`): two-step claim with re-checked conditional update and token fencing.
  Result on v8.5.3: 20 workers × 10,000 jobs → 10,000 effects, 10,000 distinct, **0 duplicates**, 0 lost leases, 31.7 s.
- Expired-lease reclaim: pass — the job is reclaimed (attempts 2) and the stale worker's heartbeat, completion and
  release are all refused. Retry backoff, release-without-attempt and exhausted-lease sweep: pass.

### T-07 on Starter

20 workers x 10,000 jobs: 10,000 effects, 10,000 distinct jobs, **0 duplicates**, 0 lost leases, 225.6 s (44 jobs/s over the internet; 315 jobs/s on the local container). Lease reclaim and fencing pass.

## Remaining to pass the gate

1. T-13: one-hour connection soak with 5-minute recycle and forced termination.
2. T-14: confirm free-tier backup visibility, restore to a scratch instance, export and re-import round trip.
3. T-15: Request Unit readings (console) for list, search and publish transactions.
