# RemitFlow Data Pipeline Technical Guide

**Version:** v90 | **Last Updated:** April 2026 | **Owner:** Platform Engineering

This guide covers the architecture, operation, and extension of the three data pipeline orchestration systems integrated into RemitFlow: Apache NiFi (ingestion), dbt (transformation), and Apache Airflow (orchestration). Together they form the ELT lakehouse backbone that powers all AI/ML features, compliance reporting, and business analytics.

---

## Architecture Overview

The pipeline architecture follows the **Bronze → Silver → Gold** lakehouse pattern:

```
External Sources          Ingestion (NiFi)         Storage (S3/MinIO)
─────────────────         ────────────────         ──────────────────
Bank APIs        ──────►  NiFi Flow 1    ──────►   Bronze Layer (raw)
SWIFT/SEPA feeds ──────►  NiFi Flow 2    ──────►   Bronze Layer (raw)
Mobile SDK       ──────►  NiFi Flow 3    ──────►   Bronze Layer (raw)
FX Rate APIs     ──────►  NiFi Flow 4    ──────►   Bronze Layer (raw)

                          Transformation (dbt)     Storage (PostgreSQL)
                          ────────────────────     ────────────────────
Bronze Layer     ──────►  stg_transactions ──────► Silver Layer (clean)
Bronze Layer     ──────►  stg_users        ──────► Silver Layer (clean)
Silver Layer     ──────►  mart_daily_vol   ──────► Gold Layer (marts)
Silver Layer     ──────►  mart_fraud_det   ──────► Gold Layer (marts)
Silver Layer     ──────►  mart_corridors   ──────► Gold Layer (marts)

                          Orchestration (Airflow)
                          ───────────────────────
                          Daily ETL DAG
                          Weekly Fraud Retrain DAG
                          Monthly Compliance DAG
```

| Layer | Technology | Purpose | Refresh Cadence |
|---|---|---|---|
| **Ingestion** | Apache NiFi 1.25 | Pull from 8 external sources, validate, route to Bronze | Real-time / 5-min batch |
| **Transformation** | dbt Core 1.8 | Clean, deduplicate, enrich, aggregate | Hourly (Silver), 4-hourly (Gold) |
| **Orchestration** | Apache Airflow 2.9 | Schedule, monitor, retry, alert on all pipeline jobs | Cron-based |
| **Vector Store** | Qdrant 1.9 | Semantic search and anomaly detection embeddings | Post-transaction |
| **Graph DB** | FalkorDB 4.0 | Fraud ring detection, transaction network analysis | Daily sync |

---

## Apache NiFi

### Overview

NiFi handles all data ingestion into the RemitFlow platform. It provides a visual drag-and-drop interface for building data flows, with built-in support for back-pressure, provenance tracking, and guaranteed delivery.

### Default Configuration

| Parameter | Default Value |
|---|---|
| NiFi URL | `http://nifi:8080` |
| API Base | `http://nifi:8080/nifi-api` |
| Admin Username | `admin` |
| Admin Password | `remitflow_nifi_2024` |
| Max Concurrent Tasks | 4 per processor |
| Back-pressure Object Threshold | 10,000 |
| Back-pressure Data Size Threshold | 1 GB |

### Pre-built Pipelines

The platform ships with 8 pre-configured NiFi pipelines:

| Pipeline ID | Name | Source | Destination | Schedule |
|---|---|---|---|---|
| `PIPE-001` | Transaction Ingestion | Bank APIs (REST) | Bronze/transactions | Every 5 min |
| `PIPE-002` | FX Rate Sync | Open Exchange Rates API | Bronze/fx_rates | Every 1 min |
| `PIPE-003` | KYC Document Ingestion | Identity verification provider | Bronze/kyc_docs | On-demand |
| `PIPE-004` | Beneficiary Sync | Partner bank APIs | Bronze/beneficiaries | Every 15 min |
| `PIPE-005` | SWIFT Message Parser | SWIFT MT103/MT202 feeds | Bronze/swift_messages | Real-time |
| `PIPE-006` | Compliance Feed | OFAC/EU/UN sanctions lists | Bronze/sanctions | Daily 01:00 |
| `PIPE-007` | Partner Payout Status | Partner payout APIs | Bronze/payout_status | Every 10 min |
| `PIPE-008` | Fraud Signal Ingestion | External threat intelligence | Bronze/fraud_signals | Every 30 min |

### Starting NiFi

```bash
# Start NiFi with the full pipeline stack
docker compose -f docker-compose.yml -f docker-compose.pipelines.yml up -d nifi

# Access the NiFi UI
open http://localhost:8080/nifi

# Trigger a specific pipeline via API
curl -X POST http://localhost:8080/nifi-api/processors/{processorId}/run-status \
  -H "Content-Type: application/json" \
  -d '{"revision": {"version": 0}, "state": "RUNNING"}'
```

### Adding a New Data Source

To add a new external data source to NiFi:

1. Open the NiFi UI at `http://localhost:8080/nifi`.
2. Drag an **InvokeHTTP** processor onto the canvas and configure the Remote URL, HTTP Method, and authentication headers.
3. Connect the output to a **SplitJson** processor to parse array responses.
4. Connect to a **PutS3Object** processor configured with the Bronze bucket path `s3://remitflow-bronze/{source_name}/`.
5. Add a **UpdateAttribute** processor to stamp each FlowFile with `source`, `ingested_at`, and `schema_version` attributes.
6. Connect to the **LogAttribute** processor for provenance tracking.
7. Register the new pipeline in `server/nifi.service.ts` under `REMITFLOW_PIPELINES`.

### Monitoring and Alerting

NiFi exposes metrics via the `/nifi-api/system-diagnostics` endpoint. The Prometheus exporter scrapes these and feeds the Grafana dashboard at `http://localhost:3001` (dashboard ID: `remitflow-nifi`). Set up alerting rules in `monitoring/prometheus/rules/nifi.yml` for:

- Back-pressure threshold exceeded (> 80% of limit)
- Processor error rate > 1% over 5 minutes
- Queue depth > 50,000 FlowFiles

---

## dbt

### Overview

dbt (data build tool) handles all SQL-based transformations in RemitFlow. It enforces schema contracts, runs data quality tests on every model refresh, and generates a lineage graph that maps every Gold mart back to its Bronze source.

### Default Configuration

| Parameter | Default Value |
|---|---|
| Profile | `remitflow` |
| Target | `prod` |
| Database | `remitflow` |
| Schema Prefix | `dbt_` |
| Threads | 4 |
| dbt Version | 1.8.x |

### Model Layers

```
models/
├── staging/          ← Silver layer: clean, typed, deduplicated
│   ├── stg_transactions.sql
│   ├── stg_users.sql
│   ├── stg_beneficiaries.sql
│   ├── stg_fx_rates.sql
│   └── stg_kyc_documents.sql
├── marts/            ← Gold layer: business-ready aggregates
│   ├── mart_daily_volume.sql
│   ├── mart_corridor_performance.sql
│   ├── mart_fraud_detection.sql
│   ├── mart_compliance_reporting.sql
│   └── mart_revenue_analytics.sql
└── sources.yml       ← Source definitions and freshness checks
```

### Running dbt

```bash
# Navigate to the dbt project directory
cd /home/ubuntu/remitflow/dbt

# Run all models
dbt run --profiles-dir .

# Run only staging models
dbt run --select staging.* --profiles-dir .

# Run fraud mart only
dbt run --select mart_fraud_detection --profiles-dir .

# Run tests
dbt test --profiles-dir .

# Generate and serve documentation
dbt docs generate --profiles-dir .
dbt docs serve --port 8081 --profiles-dir .

# Check source freshness
dbt source freshness --profiles-dir .
```

### Adding a New Mart

To add a new Gold mart (e.g., `mart_partner_performance`):

1. Create `models/marts/mart_partner_performance.sql` with the appropriate `{{ config(...) }}` block.
2. Reference upstream staging models using `{{ ref('stg_transactions') }}` — never reference raw tables directly.
3. Add schema tests in `models/marts/schema.yml`:
   ```yaml
   - name: mart_partner_performance
     columns:
       - name: partner_id
         tests: [not_null, unique]
       - name: total_volume_usd
         tests: [not_null, dbt_utils.accepted_range: {min_value: 0}]
   ```
4. Register the model in `server/dbt.service.ts` under `DBT_MODELS`.
5. Add a dbt run step to the Airflow DAG `remitflow_daily_etl`.

### Data Quality Tests

Every staging model includes the following standard tests:

| Test | Description | Severity |
|---|---|---|
| `not_null` | No NULL values in primary key columns | Error |
| `unique` | No duplicate primary keys | Error |
| `accepted_values` | Status fields only contain valid enum values | Error |
| `relationships` | Foreign key integrity to parent tables | Warn |
| `dbt_utils.expression_is_true` | Business rule validation (e.g., amount > 0) | Error |
| `dbt_utils.recency` | Source data not older than 2 hours | Warn |

---

## Apache Airflow

### Overview

Airflow orchestrates all scheduled pipeline jobs in RemitFlow. It provides dependency management, retry logic, SLA monitoring, and email alerting for all data pipeline failures.

### Default Configuration

| Parameter | Default Value |
|---|---|
| Airflow URL | `http://airflow:8082` |
| Admin Username | `admin` |
| Admin Password | `remitflow_airflow_2024` |
| Executor | `LocalExecutor` (dev) / `CeleryExecutor` (prod) |
| Metadata DB | `postgresql://airflow:airflow@postgres:5432/airflow` |
| DAG Directory | `/opt/airflow/dags` |
| Log Directory | `/opt/airflow/logs` |

### Production DAGs

| DAG ID | Schedule | SLA | Description |
|---|---|---|---|
| `remitflow_daily_etl` | `0 1 * * *` | 2h | Full Bronze → Silver → Gold refresh |
| `remitflow_fraud_model_retrain_v2` | `0 2 * * 0` | 4h | Weekly fraud ML retraining |
| `remitflow_compliance_reporting` | `0 3 1 * *` | 6h | Monthly regulatory reports (CTR, SAR, FBAR) |
| `remitflow_fx_rate_sync` | `*/5 * * * *` | 10m | Real-time FX rate ingestion |
| `remitflow_sanctions_refresh` | `0 1 * * *` | 1h | Daily OFAC/EU/UN sanctions list update |

### Starting Airflow

```bash
# Start Airflow with the pipeline stack
docker compose -f docker-compose.yml -f docker-compose.pipelines.yml up -d airflow-webserver airflow-scheduler

# Access the Airflow UI
open http://localhost:8082

# Trigger a DAG manually
curl -X POST http://localhost:8082/api/v1/dags/remitflow_daily_etl/dagRuns \
  -H "Content-Type: application/json" \
  -u admin:remitflow_airflow_2024 \
  -d '{"conf": {}}'

# Check DAG run status
curl http://localhost:8082/api/v1/dags/remitflow_daily_etl/dagRuns \
  -u admin:remitflow_airflow_2024 | jq '.dag_runs[-1]'
```

### Adding a New DAG

To add a new Airflow DAG:

1. Create a Python file in `/home/ubuntu/remitflow/airflow/dags/` following the naming convention `remitflow_{feature}_{frequency}.py`.
2. Define `DEFAULT_ARGS` with `owner`, `email`, `retries`, `retry_delay`, and `sla`.
3. Use `BranchPythonOperator` for conditional logic (e.g., promote model only if metrics improve).
4. Always set `max_active_runs=1` for data pipeline DAGs to prevent concurrent runs.
5. Register the DAG in `server/airflow.service.ts` under `REMITFLOW_DAGS`.
6. Add a smoke test in `server/smoke-v90.test.ts` to verify the DAG file is valid Python.

### SLA and Alerting

Configure SLA miss callbacks in `airflow/config/airflow.cfg`:

```ini
[email]
email_backend = airflow.utils.email.send_email_smtp
smtp_host = smtp.remitflow.com
smtp_starttls = True
smtp_ssl = False
smtp_user = airflow@remitflow.com
smtp_password = ${SMTP_PASSWORD}
smtp_port = 587
smtp_mail_from = airflow@remitflow.com
```

SLA misses trigger PagerDuty alerts via the `remitflow_sla_callback` function defined in `airflow/plugins/remitflow_callbacks.py`.

---

## End-to-End Pipeline Walkthrough

The following example traces a single $2,500 USD → NGN transaction through the complete pipeline:

**Step 1 — Transaction Created (real-time):** The user submits a transfer in the RemitFlow UI. The `transfer.send` tRPC procedure inserts the transaction into PostgreSQL and calls `qdrantService.indexTransaction()` to create a vector embedding for similarity search.

**Step 2 — NiFi Ingestion (5-minute batch):** NiFi Pipeline `PIPE-001` polls the bank API for new transaction status updates and writes them to `s3://remitflow-bronze/transactions/2026/04/21/`.

**Step 3 — dbt Staging (hourly):** The `stg_transactions` model reads from Bronze, applies type casting, deduplication, and currency normalization, and writes to the Silver layer in PostgreSQL.

**Step 4 — dbt Mart (4-hourly):** The `mart_fraud_detection` model joins the staging transaction with user velocity, corridor risk, and structuring signals to produce a fully enriched fraud feature row in the Gold layer.

**Step 5 — Airflow Orchestration (daily):** The `remitflow_daily_etl` DAG runs the full dbt model graph, validates data freshness, and triggers the Grafana dashboard refresh.

**Step 6 — Fraud Model Retraining (weekly):** The `remitflow_fraud_model_retrain_v2` DAG extracts 90 days of labeled data from `mart_fraud_detection`, trains a new ensemble model, evaluates it against the holdout set, and promotes it to production if F1 improves.

**Step 7 — Compliance Reporting (monthly):** The `remitflow_compliance_reporting` DAG reads from `mart_compliance_reporting` to generate CTR (FinCEN Form 112) and SAR (FinCEN Form 111) reports for all qualifying transactions.

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---|---|---|
| NiFi processor stuck in STOPPED state | Back-pressure threshold exceeded | Increase downstream throughput or clear the queue via NiFi UI |
| dbt run fails with `relation does not exist` | Missing upstream model or schema | Run `dbt run --select +mart_fraud_detection` to build the full dependency chain |
| Airflow DAG not appearing in UI | Python syntax error in DAG file | Check `airflow scheduler` logs: `docker logs remitflow-airflow-scheduler` |
| Airflow task stuck in `queued` state | Executor capacity exhausted | Scale up `AIRFLOW__CORE__PARALLELISM` in `docker-compose.pipelines.yml` |
| Qdrant collection not found | Service not running or collection not created | Run `docker compose up -d qdrant` and call `POST /collections/transactions` |
| FalkorDB connection refused | Service not running | Run `docker compose -f docker-compose.ai.yml up -d falkordb` |

---

## Security Considerations

All pipeline services run in an isolated Docker network (`remitflow-pipelines`). External access is restricted to the Traefik reverse proxy. Credentials are injected via environment variables — never hardcoded. The NiFi keystore and truststore are generated at container startup using the NiFi TLS Toolkit. Airflow uses Fernet encryption for connection passwords stored in the metadata database.

For production deployments, replace the default passwords in `docker-compose.pipelines.yml` with secrets from HashiCorp Vault or AWS Secrets Manager.
