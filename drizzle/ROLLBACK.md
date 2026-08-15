# Rollback / Roll-Forward Strategy

The migration runner (`scripts/migrate.mjs`) applies each `NNNN_name.sql` file
in a **single transaction** and pins it by SHA-256 checksum in
`platform_schema_migrations`. A failed statement rolls back the whole file, so
a partially-applied migration is impossible; the runner halts and re-runs the
failed file on the next deploy. There are no `down` migrations — corrections
ship as new forward migrations. This document records the reversal path for
each migration in the current remediation wave and the general policy.

## General policy

1. **Roll forward, not back.** Once a migration is checksum-pinned, never edit
   it; ship a corrective migration instead.
2. **Failed apply = safe retry.** Because each file runs in one transaction,
   re-running `pnpm db:migrate` after fixing the underlying issue (permissions,
   lock contention, disk) simply re-applies the failed file.
3. **Idempotency.** Every migration in this wave uses `IF NOT EXISTS` /
   `IF EXISTS` guards so a re-apply after a crash between COMMIT and the
   bookkeeping insert is safe.
4. **Reversal SQL below is manual.** It is provided for disaster recovery and
   non-production resets. It is intentionally NOT automated, because dropping
   structures destroys the data they hold.

## Lock-risk classification

| Level | Meaning |
|---|---|
| LOW | Metadata-only or new objects; no lock on existing hot tables. |
| MEDIUM | Takes short `ACCESS EXCLUSIVE` on an existing table (fast `ADD COLUMN` without volatile default) or builds an index non-concurrently (blocks writes on that table for the duration). |
| HIGH | Rewrites an existing table (type change) under `ACCESS EXCLUSIVE` for the duration of the rewrite. |

## Per-migration notes

### `0080_mojaloop_pending_state.sql` — LOW
Creates `mojaloop_pending_transfers`, `mojaloop_pending_callbacks` (+2 indexes).
All statements guarded by `IF NOT EXISTS`. No existing table is touched.
- **Roll-forward fix:** n/a (new objects only).
- **Manual reversal:** `DROP TABLE IF EXISTS mojaloop_pending_callbacks; DROP TABLE IF EXISTS mojaloop_pending_transfers;`
  Only safe before any in-flight Mojaloop transfer; rows hold live callback
  correlation state.

### `0081_dlq_messages.sql` — LOW
Creates `dlq_messages` (+4 indexes, one partial, one UNIQUE). All guarded.
- **Manual reversal:** `DROP TABLE IF EXISTS dlq_messages;`
  Destroys persisted DLQ history — export first if reprocessing is pending
  (`status='pending'` rows).

### `0082_tigerbeetle_id_widening.sql` — HIGH (table rewrite)
Widens `tigerbeetle_accounts.tb_account_id`,
`tigerbeetle_transfers.tb_transfer_id|debit_account_id|credit_account_id`
from `bigint` to `TEXT` (u128 decimal strings), adds
`flags`, `user_data_128`, `pending_id` columns, and recreates UNIQUE indexes.
`ALTER COLUMN ... TYPE TEXT` **rewrites both tables** and holds
`ACCESS EXCLUSIVE` for the rewrite; the follow-on `CREATE UNIQUE INDEX`
statements block writes while building.
- **Rehearsal requirement:** run against a production-volume copy; measure
  rewrite time. If the mirror tables are large, schedule a maintenance window
  or pre-copy data into new tables and swap.
- **Data safety:** `bigint` → `TEXT` is a lossless widening. The reverse
  (`TEXT` → `bigint`) is **lossy/failing** once any id > 2^63-1 exists, which
  is the entire point of the migration — so there is no safe down-migration
  after TB ids have been written. Treat as one-way in production.
- **Manual reversal (only valid if no u128-width ids were written):**
  `ALTER TABLE tigerbeetle_accounts ALTER COLUMN tb_account_id TYPE BIGINT USING tb_account_id::bigint;`
  and the equivalent for `tigerbeetle_transfers`; then drop
  `flags`, `user_data_128`, `pending_id` if desired.
- **Idempotency:** `DROP CONSTRAINT IF EXISTS` / `ADD COLUMN IF NOT EXISTS` /
  `CREATE ... IF NOT EXISTS` are guarded; re-applying the bare
  `ALTER COLUMN ... TYPE TEXT` on an already-TEXT column is a no-op rewrite
  plan in PostgreSQL (type is unchanged) and is safe.

### `0083_outbox_worker_lease.sql` — MEDIUM
Adds nullable `locked_at`, `locked_by` to the hot `outbox_events` table
(metadata-only, no table rewrite — nullable columns without defaults) and
builds two partial indexes non-concurrently (brief write block on
`outbox_events`).
- **Manual reversal:** `DROP INDEX IF EXISTS outbox_events_claim_idx; DROP INDEX IF EXISTS outbox_events_dead_letter_idx; ALTER TABLE outbox_events DROP COLUMN IF EXISTS locked_at, DROP COLUMN IF EXISTS locked_by;`
  Only safe when no outbox worker holds a lease; redrive `dead_letter` rows
  first if needed (`requeueDeadLetters()`).

## Rehearsal checklist (per deploy)

1. Apply against a restored production snapshot with production-like volume.
2. Capture `pg_stat_activity` lock waits during 0082 specifically.
3. Verify `platform_schema_migrations` contains exactly one row per file with
   matching checksums.
4. Re-run `pnpm db:migrate` to confirm every file reports `skip`.
