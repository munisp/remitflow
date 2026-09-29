# RemitFlow Lakehouse — Wave 10 (C6)

Medallion-layout lakehouse fed by the Fluvio bronze writer and analyzed with
the existing DuckDB/Parquet ETL service.

> **Honesty note (W18):** No Apache Sedona / Spark runtime exists anywhere in
> this platform — there is no Spark container, job, or dependency in compose,
> deploy, or any service. `sedona_queries.sql` is **future work**: candidate
> spatial queries to run IF a Spark+Sedona cluster is ever provisioned. Until
> then nothing executes them; spatial analytics in production come from
> `python-geo-analytics` (PostGIS) only.

## Layout

```
{LAKE_DIR}/                                   # shared volume: lakehouse-data (/data/lakehouse)
└── bronze/
    ├── ledger-events-bronze/
    │   └── dt=YYYY-MM-DD/
    │       └── part-<unixts>-<seq>.parquet   # rust-lakehouse-writer output
    └── bill-capture-extracted/
        └── dt=YYYY-MM-DD/
            └── part-<unixts>-<seq>.parquet
```

- **bronze** — raw Fluvio records, one Parquet file per flush
  (every 500 messages or 30s, whichever first). Columns are
  schema-inferred per batch: flattened dotted-path scalar fields
  (string/float64/bool, conflicts promoted to string) plus reserved metadata
  columns `_raw_json` (lossless original payload), `_offset`,
  `_ingested_at_unix`. Malformed JSON is still persisted via `_raw_json` —
  bronze never loses bytes.
- **silver** — cleaned/typed tables (see `silver_transforms.md`):
  deduplication on `_offset`, precise decimal amounts, exploded line items,
  validity filtering. Produced by scheduled DuckDB jobs (lakehouse-etl)
  reading bronze and writing `{LAKE_DIR}/silver/<table>/dt=...`.
- **gold** — business aggregates (corridor density, agent coverage,
  daily ledger rollups) consumed by dashboards and the TS API. Written to
  `{LAKE_DIR}/gold/<aggregate>/dt=...`.

## Components

| Component | Role |
|---|---|
| `services/rust-lakehouse-writer` | Fluvio consumer group `lakehouse-writer` on `ledger-events-bronze` + `bill-capture-extracted`; writes bronze Parquet; `/metrics` + `/health` on :9115. Fails closed when `FLUVIO_ENDPOINT`/`LAKE_DIR` unset. |
| `services/lakehouse-etl` (existing) | DuckDB/Parquet ETL API on :8089, shares the `lakehouse-data` volume — reads the same bronze files. |
| `sedona_queries.sql` (**future work — no runtime**) | Candidate Spark/Sedona spatial SQL for corridor-density / agent-coverage analysis over bronze. NOT executed by anything today; requires provisioning a Spark+Sedona cluster first. |

## Spatial analytics today (and the Sedona future work)

Production spatial analytics run in `python-geo-analytics` (:8114) against
PostGIS. The Sedona path in `sedona_queries.sql` documents how corridor-
density / agent-coverage aggregates WOULD be computed (`ST_GeomFromWKT`,
`ST_Distance`, `ST_Within` over bronze Parquet) if a Spark+Sedona cluster is
ever added. Do not read this as an existing capability — no Spark session,
Sedona jar, or scheduled job exists in this repository's deployable units.

## Relational side

The Drizzle tables `operational_geo_locations` /
`operational_geo_corridors` (drizzle/schema.ts) hold the tenant-scoped
authoritative corridor/agent geography. The lakehouse is the analytical
mirror: bronze keeps the raw event stream, silver/gold hold the spatial
aggregates that back `python-geo-analytics` (:8114) corridor-coverage
dashboards. The geo-analytics service never fabricates geo data — empty
input yields an empty result with a warning.
