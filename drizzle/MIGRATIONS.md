# Database Migrations — Canonical Track

## One track only

The canonical, deploy-time migration track is **this directory** (`drizzle/*.sql`).
`scripts/migrate.mjs` enumerates every root-level file matching `NNNN_name.sql`,
sorts it lexicographically, and applies it exactly once (checksum-pinned via the
`platform_schema_migrations` table). There is no other track.

The former `drizzle/migrations/` subdirectory was a divergent second track that
`migrate.mjs` never read. It has been removed:

- `drizzle/migrations/0063_agent_cash_pickup.sql` and `0064_p2p_instant_tables.sql`
  were an abandoned, incompatible re-definition of tables already created by the
  canonical `0064_agent_cash_pickup_schema.sql` / `0051_military_silver_sable.sql`
  (different column sets for `agent_network`, `cash_pickup_assignments`,
  `float_topup_requests`; `p2p_*`/`payment_aliases` already canonical since 0051).
  They were deleted without replacement — nothing in the deploy path ever applied
  them, and the canonical schema (`drizzle/schema.ts`) matches the root files.
- `drizzle/migrations/0065_dlq_messages.sql` was legitimate new work and was
  promoted into the canonical track as **`0081_dlq_messages.sql`**.

## Current sequence

`0000_baseline_schema.sql`, then `0051_*.sql` … `0083_*.sql` (numbers 0001–0050
were never part of this repository's applied history; the journal documents the
files that actually exist — do not invent migrations for the gap).

Tail of the sequence:

| File | Purpose |
|---|---|
| `0080_mojaloop_pending_state.sql` | Mojaloop pending-transfer state |
| `0081_dlq_messages.sql` | Kafka DLQ persistence (promoted from the deleted divergent track) |
| `0082_tigerbeetle_id_widening.sql` | TB ids widened to TEXT (u128), UNIQUE(user_id,currency), flags/user_data_128/pending_id |
| `0083_outbox_worker_lease.sql` | Outbox worker lease columns (locked_at/locked_by) + claim/dead-letter indexes |

## `drizzle/meta/_journal.json`

The journal now mirrors reality: one entry per root SQL file that exists
(`0000`, `0051`–`0081`), monotonically increasing `when` timestamps. It is
documentary — `migrate.mjs` applies files directly and does not consult the
journal — but it is kept accurate so `drizzle-kit` tooling and humans see a
single coherent history. Only `meta/0051_snapshot.json` survives from the old
tooling snapshots; new hand-written migrations do not require snapshots.

## Rules for new migrations

1. Add the next number in the root sequence (`0082_*.sql`, `0083_*.sql`, …).
   Never create `drizzle/migrations/` again; `drizzle.config.ts` `out` points at
   `./drizzle` so generated files land in the canonical track.
2. Every statement must be idempotent (`IF NOT EXISTS` / `IF EXISTS`) — the
   applier wraps each file in one transaction and enforces checksum immutability
   after application.
3. Never edit a file after it has been applied anywhere (checksum mismatch
   aborts the deploy). Fix forward with a new migration.
4. Add a matching entry to `drizzle/meta/_journal.json` (next `idx`, `when`
   greater than the previous entry, `tag` = filename without `.sql`).
