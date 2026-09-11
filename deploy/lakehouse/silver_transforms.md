# Bronze → Silver transforms — Wave 10 (C6)

Bronze (written by `rust-lakehouse-writer`) is intentionally permissive:
per-batch schema inference, all numbers as float64, conflicts promoted to
string, raw payload preserved in `_raw_json`. Silver is where data becomes
typed, deduplicated, and trustworthy. **Rules: never invent rows, never
repair values by guessing — drop invalid records into a quarantine path and
count them.**

## General cleaning rules (apply to every bronze topic)

1. **Deduplication** — key: `(topic partition offset)` via `_offset` plus
   the producer idempotency key when present in the payload
   (`idempotency_key` / `event_id`). Keep first occurrence by
   `_ingested_at_unix`.
2. **Type tightening** — cast float64 amount fields to `DECIMAL(19,4)`;
   reject (quarantine) negatives where the domain forbids them, NaN/Inf.
3. **Coordinate validity** — `lat ∈ [-90,90]`, `lon ∈ [-180,180]`; anything
   outside goes to quarantine (the Sedona views also filter defensively).
4. **Reserved columns passthrough** — `_offset`, `_ingested_at_unix` kept
   for lineage; `_raw_json` dropped from silver (still available in bronze).
5. **Quarantine** — invalid rows are written to
   `{LAKE_DIR}/silver/_quarantine/<topic>/dt=...` with a `reason` column;
   counts are emitted as metrics. Quarantine is data, not silence.

## `ledger-events-bronze` → `silver/ledger_events`

- Flattened columns expected from the TS ledger producer:
  `event_id, event_type, corridor_code, amount, currency,
  origin_lat, origin_lon, dest_lat, dest_lon, tenant_id, occurred_at`.
- Steps: dedupe on `event_id` → decimal-cast `amount` → coordinate validity →
  enum-check `event_type` against the server event vocabulary → parse
  `occurred_at` to timestamp; records failing any check → quarantine.
- Output: `{LAKE_DIR}/silver/ledger_events/dt=YYYY-MM-DD/part-*.parquet`,
  partitioned by event date (not ingest date).

## `bill-capture-extracted` → `silver/bill_extractions`

- Columns from the OCR pipeline (C3): `job_id, bill_id, vendor, amount,
  currency, due_date, invoice_number, confidence, line_items` (array →
  JSON string in bronze).
- Steps: dedupe on `job_id` → decimal-cast `amount` → explode `line_items`
  JSON array into `silver/bill_line_items` (one row per line, `job_id` FK) →
  split by confidence: `confidence >= 0.85` → `silver/bill_extractions`;
  below → `silver/bill_extractions_review` (mirrors the TS
  `confirmExtraction` human-review rule — low-confidence OCR is NEVER
  auto-applied).
- Malformed-JSON bronze rows (empty flattened record, `_raw_json` only) go
  straight to quarantine with reason `unparseable_payload`.

## Geo dimensions export (relational → silver)

The Sedona queries join bronze events against corridor/agent geography. The
authoritative source is relational (drizzle `operational_geo_locations` /
`operational_geo_corridors`); a scheduled export (lakehouse-etl service or
Sedona JDBC read) produces:

- `silver/geo_agents` — `operational_geo_locations` where
  `location_type='agent' AND operational_status='active'`:
  `agent_id (external_ref), tenant_id, lat, lon, country_code,
  float_usd (from metadata), observed_at`.
- `silver/geo_corridors` — `operational_geo_corridors` joined to origin and
  destination locations:
  `corridor_code, tenant_id, origin_lat, origin_lon, dest_lat, dest_lon,
  operational_status, observed_at`.

Export cadence: hourly (dimension data is slow-moving). Exports are full
snapshots partitioned by export date; consumers read the latest partition.

## Silver → Gold (summary)

- `gold/corridor_density_daily` — from `sedona_queries.sql` §3.
- `gold/corridor_agent_coverage` — §4/§5 (feeds the underserved-corridor
  list surfaced by `python-geo-analytics` dashboards).
- `gold/ledger_rollup_daily` — per-corridor/currency sums, counts, p95
  amounts from `silver/ledger_events`.

Gold aggregates are recomputed, never incrementally patched, so reprocessing
after a quarantine fix is always safe.
