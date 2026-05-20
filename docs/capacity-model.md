# RemitFlow Capacity Model

> *Derived from the napkin math methodology in [1B Payments/Day](https://backend.how/posts/1b-payments-per-day/). Design for 5× average, not 1× average.*

---

## Tier Projections

| Metric | 10K DAU | 100K DAU | 1M DAU |
|---|---|---|---|
| Transfers/day | 50,000 | 500,000 | 5,000,000 |
| Average TPS | 0.58 | 5.8 | 57.9 |
| Peak TPS (2.5× diurnal) | 1.45 | 14.5 | 144.7 |
| Design TPS (5× average) | 2.9 | 29 | 289 |
| Raw data/day (128 B/row) | 6.4 MB | 64 MB | 640 MB |
| Hot tier (90 days, 6 replicas) | 3.5 GB | 35 GB | 350 GB |
| Cold tier (1 year, 4.7× compression) | 0.5 GB | 5 GB | 50 GB |

## Database Connection Pool

| Tier | Formula | Recommended Pool Size |
|---|---|---|
| 10K DAU | ceil(2.9 TPS × 10ms avg) | 5–10 |
| 100K DAU | ceil(29 TPS × 10ms avg) | 10–20 |
| 1M DAU | ceil(289 TPS × 10ms avg) | 20–50 |

Current setting: `min: 5, max: 20` (configured in `server/_core/db.ts`).

## Kafka Partition Count

Rule of thumb: 1 partition per 10 MB/s sustained throughput.

| Tier | Throughput | Partitions |
|---|---|---|
| 10K DAU | ~0.1 MB/s | 3 (minimum) |
| 100K DAU | ~1 MB/s | 3–6 |
| 1M DAU | ~10 MB/s | 12–24 |

## Rate Limiter Thresholds

| Endpoint | Current Limit | 1M DAU Recommended |
|---|---|---|
| `transfers.create` | 10 req/s/user | 5 req/s/user |
| `wallets.topUp` | 5 req/s/user | 3 req/s/user |
| `auth.login` | 5 req/s/IP | 3 req/s/IP |
| `kyc.submit` | 3 req/s/user | 1 req/s/user |

## Transfer Batch Queue Tuning

| Metric | Current | 1M DAU Target |
|---|---|---|
| Batch size | 100 rows | 500–1000 rows |
| Flush interval | 50 ms | 20–50 ms |
| Expected fsync reduction | 100× | 500–1000× |
| Expected TPS | 2,000–5,000 | 10,000–30,000 |

## Storage Tiering Schedule

| Age | Tier | Action |
|---|---|---|
| 0–90 days | Hot — primary TiDB | Active queries, full indexes |
| 90 days–1 year | Warm — `archived_at IS NOT NULL` | Partial index, reduced query surface |
| 1–10 years | Cold — S3 NDJSON+gzip | go-export-service, query via Athena |

## Scaling Triggers

The following metrics should trigger a scaling review:

- Database CPU > 70% sustained for 5 minutes
- Connection pool utilization > 80%
- Transfer batch queue depth > 500 items
- Kafka consumer lag > 10,000 messages
- Wallet cache hit rate < 60%
- p99 transfer latency > 500 ms

## TigerBeetle Migration Threshold

Based on the benchmark, TigerBeetle becomes cost-effective when:

- Sustained TPS > 5,000 (TiDB approaches its single-node limit)
- Daily transfers > 50M (hot tier exceeds 600 GB)
- p99 transfer latency > 200 ms (fsync tax dominates)

At 1M DAU with 5M transfers/day, RemitFlow will approach this threshold within 12–18 months of launch.
