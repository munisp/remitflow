# RemitFlow Lakehouse — Wave 10 (C6)

Medallion-layout lakehouse fed by the Fluvio bronze writer and analyzed with
Apache Sedona (Spark SQL) and the existing DuckDB/Parquet ETL service.

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
  validity filtering. Produced by scheduled Sedona/DuckDB jobs reading
  bronze and writing `{LAKE_DIR}/silver/<table>/dt=...`.
- **gold** — business aggregates (corridor density, agent coverage,
  daily ledger rollups) consumed by dashboards and the TS API. Written to
  `{LAKE_DIR}/gold/<aggregate>/dt=...`.

## Components

| Component | Role |
|---|---|
| `services/rust-lakehouse-writer` | Fluvio consumer group `lakehouse-writer` on `ledger-events-bronze` + `bill-capture-extracted`; writes bronze Parquet; `/metrics` + `/health` on :9115. Fails closed when `FLUVIO_ENDPOINT`/`LAKE_DIR` unset. |
| `services/lakehouse-etl` (existing) | DuckDB/Parquet ETL API on :8089, shares the `lakehouse-data` volume — reads the same bronze files. |
| Apache Sedona (Spark) | Runs `sedona_queries.sql` for spatial corridor-density / agent-coverage analysis over bronze. |

## Where Apache Sedona fits

Sedona registers spatial SQL functions (`ST_GeomFromWKT`, `ST_Distance`,
`ST_Within`, `ST_KNN`, …) on a Spark session. Bronze Parquet is plain
flat-column data, so Sedona reads it directly via
`spark.read.parquet("{LAKE_DIR}/bronze/...")`; geometry points are
materialized with `ST_GeomFromWKT` in views (see `sedona_queries.sql`).

Bootstrap (Spark shell / notebook / job):

```scala
import org.apache.sedona.spark.SedonaContext
val sedona = SedonaContext.create(spark)
```

Then execute the statements in `sedona_queries.sql` in order — each
`CREATE OR REPLACE TEMP VIEW` builds on the previous one.

## Relational side

The Drizzle tables `operational_geo_locations` /
`operational_geo_corridors` (drizzle/schema.ts) hold the tenant-scoped
authoritative corridor/agent geography. The lakehouse is the analytical
mirror: bronze keeps the raw event stream, silver/gold hold the spatial
aggregates that back `python-geo-analytics` (:8114) corridor-coverage
dashboards. The geo-analytics service never fabricates geo data — empty
input yields an empty result with a warning.
