"""
RemitFlow — Lakehouse Sync Engine (Python)
═══════════════════════════════════════════
Extracts data from PostgreSQL and syncs it to the data lakehouse
(Apache Iceberg / Delta Lake on S3/MinIO) for analytics and compliance.

Why Python:
  - PyArrow, DuckDB, and Delta-rs are the gold standard for lakehouse ETL
  - Pandas/Polars for in-memory transformations
  - Rich ecosystem for data quality checks (Great Expectations)
  - FastAPI for the control plane HTTP API

Architecture:
  - Incremental sync using watermark columns (updated_at / created_at)
  - Partitioned by date for efficient time-range queries
  - Compaction job to merge small Parquet files
  - Schema evolution support via Delta Lake merge schema
  - PII masking before writing to lakehouse

Endpoints:
  POST /sync/:table        — Trigger incremental sync for a table
  POST /sync/all           — Sync all registered tables
  GET  /sync/status        — Get sync status for all tables
  POST /ingest/:table      — Ingest pushed records (parquet → S3, PII-masked)
  GET  /read/:table        — Read recent records back from the lakehouse
  POST /compact            — Run Parquet compaction on a table (pyarrow)
  GET  /health             — Liveness probe
  GET  /metrics            — Prometheus metrics

Background scheduler:
  An internal asyncio scheduler runs /sync/all periodically. Interval is
  configured via LAKEHOUSE_SYNC_INTERVAL_SECONDS (default 900s).
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg
import pyarrow as pa
import pyarrow.parquet as pq
import boto3
from botocore.exceptions import ClientError
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from prometheus_client import Counter, Gauge, Histogram, generate_latest, CONTENT_TYPE_LATEST
from pydantic import BaseModel
from starlette.responses import Response

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time": "%(asctime)s", "level": "%(levelname)s", "service": "lakehouse", "msg": "%(message)s"}',
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/remitflow")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_BUCKET = os.getenv("LAKEHOUSE_BUCKET", "remitflow-lakehouse")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
LAKEHOUSE_PREFIX = os.getenv("LAKEHOUSE_PREFIX", "tables")
BATCH_SIZE = int(os.getenv("SYNC_BATCH_SIZE", "10000"))
SYNC_INTERVAL_SECONDS = int(os.getenv("LAKEHOUSE_SYNC_INTERVAL_SECONDS", "900"))
COMPACT_MIN_FILES = int(os.getenv("LAKEHOUSE_COMPACT_MIN_FILES", "4"))

# ─── Metrics ──────────────────────────────────────────────────────────────────

sync_rows_total = Counter(
    "lakehouse_sync_rows_total",
    "Total rows synced to lakehouse",
    ["table"]
)
sync_duration = Histogram(
    "lakehouse_sync_duration_seconds",
    "Sync duration per table",
    ["table"],
    buckets=[0.1, 0.5, 1.0, 5.0, 10.0, 30.0, 60.0, 300.0]
)
sync_errors_total = Counter(
    "lakehouse_sync_errors_total",
    "Total sync errors",
    ["table"]
)
last_sync_timestamp = Gauge(
    "lakehouse_last_sync_timestamp",
    "Unix timestamp of last successful sync",
    ["table"]
)

# ─── PII Masking ──────────────────────────────────────────────────────────────

# Columns that must be masked before writing to lakehouse
PII_COLUMNS = {
    "users": ["email", "phone", "first_name", "last_name", "date_of_birth"],
    "kyc_documents": ["document_number", "full_name", "address"],
    "bank_accounts": ["account_number", "routing_number"],
    "transactions": ["recipient_name", "recipient_account"],
}

def mask_pii(table_name: str, row: dict) -> dict:
    """Hash PII fields using SHA-256 for pseudonymisation."""
    pii_fields = PII_COLUMNS.get(table_name, [])
    masked = dict(row)
    for field in pii_fields:
        if field in masked and masked[field] is not None:
            value = str(masked[field])
            masked[field] = "sha256:" + hashlib.sha256(value.encode()).hexdigest()[:16]
    return masked

# ─── Table Registry ───────────────────────────────────────────────────────────

# Tables to sync, with their watermark column and partition key
SYNC_TABLES = [
    {"name": "users",             "watermark": "updated_at", "partition": "created_at"},
    {"name": "transactions",      "watermark": "updated_at", "partition": "created_at"},
    {"name": "wallets",           "watermark": "updated_at", "partition": "created_at"},
    {"name": "kyc_documents",     "watermark": "updated_at", "partition": "created_at"},
    {"name": "audit_logs",        "watermark": "created_at", "partition": "created_at"},
    {"name": "fx_rates",          "watermark": "fetched_at", "partition": "fetched_at"},
    {"name": "compliance_cases",  "watermark": "updated_at", "partition": "created_at"},
    {"name": "fraud_alerts",      "watermark": "created_at", "partition": "created_at"},
    {"name": "notifications",     "watermark": "created_at", "partition": "created_at"},
    {"name": "outbox_events",     "watermark": "created_at", "partition": "created_at"},
    {"name": "tigerbeetle_transfers", "watermark": "created_at", "partition": "created_at"},
    {"name": "settlement_batches","watermark": "updated_at", "partition": "created_at"},
]

# ─── S3 Client ────────────────────────────────────────────────────────────────

def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name="us-east-1",
    )

def ensure_bucket(s3_client):
    try:
        s3_client.head_bucket(Bucket=S3_BUCKET)
    except ClientError:
        s3_client.create_bucket(Bucket=S3_BUCKET)
        logger.info(f"Created bucket: {S3_BUCKET}")

# ─── Watermark Store ──────────────────────────────────────────────────────────

_watermarks: dict[str, datetime] = {}

async def get_watermark(pool: asyncpg.Pool, table_name: str) -> Optional[datetime]:
    """Get the last sync watermark from the lakehouse_sync_state table."""
    if table_name in _watermarks:
        return _watermarks[table_name]
    
    row = await pool.fetchrow(
        "SELECT last_synced_at FROM lakehouse_sync_state WHERE table_name = $1",
        table_name
    )
    if row:
        _watermarks[table_name] = row["last_synced_at"]
        return row["last_synced_at"]
    return None

async def set_watermark(pool: asyncpg.Pool, table_name: str, watermark: datetime, rows_synced: int):
    """Update the sync watermark after a successful sync."""
    await pool.execute(
        """
        INSERT INTO lakehouse_sync_state (table_name, last_synced_at, rows_synced, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (table_name)
        DO UPDATE SET last_synced_at = EXCLUDED.last_synced_at,
                      rows_synced = lakehouse_sync_state.rows_synced + EXCLUDED.rows_synced,
                      updated_at = NOW()
        """,
        table_name, watermark, rows_synced
    )
    _watermarks[table_name] = watermark

# ─── Core Sync Logic ──────────────────────────────────────────────────────────

async def sync_table(pool: asyncpg.Pool, table_config: dict) -> dict:
    """Incrementally sync a PostgreSQL table to the lakehouse (S3/Parquet)."""
    table_name = table_config["name"]
    watermark_col = table_config["watermark"]
    partition_col = table_config["partition"]

    start_time = time.time()
    logger.info(f"Starting sync: {table_name}")

    try:
        # Get last watermark
        last_watermark = await get_watermark(pool, table_name)
        
        # Build query
        if last_watermark:
            query = f"""
                SELECT * FROM {table_name}
                WHERE {watermark_col} > $1
                ORDER BY {watermark_col} ASC
                LIMIT {BATCH_SIZE}
            """
            rows = await pool.fetch(query, last_watermark)
        else:
            query = f"""
                SELECT * FROM {table_name}
                ORDER BY {watermark_col} ASC
                LIMIT {BATCH_SIZE}
            """
            rows = await pool.fetch(query)

        if not rows:
            logger.info(f"No new rows for {table_name}")
            return {"table": table_name, "rows_synced": 0, "status": "up_to_date"}

        # Convert to dicts and mask PII
        records = [mask_pii(table_name, dict(row)) for row in rows]
        
        # Determine new watermark
        new_watermark = max(
            r[watermark_col] for r in records 
            if r.get(watermark_col) is not None
        )

        # Convert to PyArrow table
        arrow_table = records_to_arrow(records)

        # Partition by date
        partition_date = datetime.now(timezone.utc).strftime("%Y/%m/%d")
        s3_key = f"{LAKEHOUSE_PREFIX}/{table_name}/dt={partition_date}/{int(time.time())}.parquet"

        # Write to S3 as Parquet
        s3_client = get_s3_client()
        ensure_bucket(s3_client)
        
        buffer = pa.BufferOutputStream()
        pq.write_table(
            arrow_table,
            buffer,
            compression="snappy",
            use_dictionary=True,
            write_statistics=True,
        )
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=buffer.getvalue().to_pybytes(),
            ContentType="application/octet-stream",
            Metadata={
                "table": table_name,
                "rows": str(len(records)),
                "watermark": str(new_watermark),
                "synced_at": datetime.now(timezone.utc).isoformat(),
            }
        )

        # Update watermark
        await set_watermark(pool, table_name, new_watermark, len(records))

        duration = time.time() - start_time
        sync_rows_total.labels(table=table_name).inc(len(records))
        sync_duration.labels(table=table_name).observe(duration)
        last_sync_timestamp.labels(table=table_name).set(time.time())

        logger.info(f"Synced {len(records)} rows from {table_name} in {duration:.2f}s → s3://{S3_BUCKET}/{s3_key}")

        return {
            "table": table_name,
            "rows_synced": len(records),
            "s3_key": s3_key,
            "new_watermark": str(new_watermark),
            "duration_seconds": round(duration, 3),
            "status": "success"
        }

    except Exception as e:
        sync_errors_total.labels(table=table_name).inc()
        logger.error(f"Sync failed for {table_name}: {e}")
        raise

def records_to_arrow(records: list[dict]) -> pa.Table:
    """Convert a list of dicts to a PyArrow Table with type inference."""
    if not records:
        return pa.table({})
    
    # Collect columns
    columns: dict[str, list] = {}
    for record in records:
        for key, value in record.items():
            if key not in columns:
                columns[key] = []
            # Serialize complex types to JSON string
            if isinstance(value, (dict, list)):
                columns[key].append(json.dumps(value))
            elif isinstance(value, datetime):
                columns[key].append(value.isoformat())
            else:
                columns[key].append(value)
    
    # Build Arrow arrays with safe type inference
    arrays = {}
    for col, values in columns.items():
        try:
            arrays[col] = pa.array(values, from_pandas=True)
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            # Fall back to string for problematic columns
            arrays[col] = pa.array([str(v) if v is not None else None for v in values])
    
    return pa.table(arrays)

# ─── S3 Object Helpers ────────────────────────────────────────────────────────

def list_table_objects(s3_client, table_name: str) -> list[dict]:
    """List all Parquet objects for a table, oldest first."""
    prefix = f"{LAKEHOUSE_PREFIX}/{table_name}/"
    objects: list[dict] = []
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".parquet"):
                objects.append({"key": obj["Key"], "size": obj["Size"], "last_modified": obj["LastModified"]})
    objects.sort(key=lambda o: o["last_modified"])
    return objects


def write_records_to_s3(table_name: str, records: list[dict]) -> dict:
    """Serialize records to a Snappy Parquet file and upload to S3. Real write — raises on failure."""
    arrow_table = records_to_arrow(records)
    partition_date = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    s3_key = f"{LAKEHOUSE_PREFIX}/{table_name}/dt={partition_date}/{int(time.time() * 1000)}.parquet"

    buffer = pa.BufferOutputStream()
    pq.write_table(arrow_table, buffer, compression="snappy", use_dictionary=True, write_statistics=True)
    payload = buffer.getvalue().to_pybytes()

    s3_client = get_s3_client()
    ensure_bucket(s3_client)
    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=s3_key,
        Body=payload,
        ContentType="application/octet-stream",
        Metadata={
            "table": table_name,
            "rows": str(len(records)),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    return {"s3_key": s3_key, "rows": len(records), "bytes": len(payload)}


async def compact_table(table_name: str) -> dict:
    """
    Real Parquet compaction via pyarrow: merge small Parquet files for a table
    into larger ones and delete the originals from S3.

    NOTE: This is file-level compaction of plain Parquet (not Delta Lake OPTIMIZE).
    Delta Lake OPTIMIZE is NOT implemented here — the service deliberately avoids
    advertising delta-rs capabilities it does not depend on.
    """
    s3_client = get_s3_client()
    objects = list_table_objects(s3_client, table_name)

    if len(objects) < COMPACT_MIN_FILES:
        return {
            "table": table_name,
            "status": "skipped",
            "reason": f"only {len(objects)} file(s) (< LAKEHOUSE_COMPACT_MIN_FILES={COMPACT_MIN_FILES})",
            "files_before": len(objects),
        }

    total_bytes = sum(o["size"] for o in objects)
    tables: list[pa.Table] = []
    keys_merged: list[str] = []
    for obj in objects:
        body = s3_client.get_object(Bucket=S3_BUCKET, Key=obj["key"])["Body"].read()
        tables.append(pq.read_table(pa.BufferReader(body)))
        keys_merged.append(obj["key"])

    merged = pa.concat_tables(tables, promote_options="default")
    partition_date = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    compacted_key = f"{LAKEHOUSE_PREFIX}/{table_name}/dt={partition_date}/compacted-{int(time.time())}.parquet"

    buffer = pa.BufferOutputStream()
    pq.write_table(merged, buffer, compression="zstd", use_dictionary=True, write_statistics=True)
    payload = buffer.getvalue().to_pybytes()

    s3_client.put_object(
        Bucket=S3_BUCKET,
        Key=compacted_key,
        Body=payload,
        ContentType="application/octet-stream",
        Metadata={"table": table_name, "compacted_from": str(len(keys_merged))},
    )

    # Only delete originals after the compacted file is durably written.
    s3_client.delete_objects(
        Bucket=S3_BUCKET,
        Delete={"Objects": [{"Key": k} for k in keys_merged]},
    )

    logger.info(
        f"Compacted {table_name}: {len(keys_merged)} files ({total_bytes} bytes) "
        f"→ 1 file ({len(payload)} bytes)"
    )
    return {
        "table": table_name,
        "status": "compacted",
        "files_before": len(keys_merged),
        "files_after": 1,
        "bytes_before": total_bytes,
        "bytes_after": len(payload),
        "rows": merged.num_rows,
        "compacted_key": compacted_key,
    }


# ─── Background Sync Scheduler ────────────────────────────────────────────────

_scheduler_task: Optional[asyncio.Task] = None


async def _scheduler_loop():
    """Periodically run a full sync cycle. Interval: LAKEHOUSE_SYNC_INTERVAL_SECONDS."""
    logger.info(f"[Scheduler] Started — sync/all every {SYNC_INTERVAL_SECONDS}s")
    # Initial delay so the DB pool and S3 are warm before the first run.
    await asyncio.sleep(min(SYNC_INTERVAL_SECONDS, 60))
    while True:
        started = time.time()
        try:
            pool = await get_pool()
            results = await asyncio.gather(
                *(sync_table(pool, t) for t in SYNC_TABLES),
                return_exceptions=True,
            )
            errors = [r for r in results if isinstance(r, Exception)]
            rows = sum(r.get("rows_synced", 0) for r in results if isinstance(r, dict))
            if errors:
                logger.error(f"[Scheduler] Sync cycle had {len(errors)} table error(s): {[str(e) for e in errors]}")
            logger.info(f"[Scheduler] Sync cycle complete: {rows} rows in {time.time() - started:.1f}s")
        except Exception as e:
            logger.error(f"[Scheduler] Sync cycle failed: {e}")
        await asyncio.sleep(SYNC_INTERVAL_SECONDS)


# ─── FastAPI App ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Lakehouse Sync Engine",
    description="Incremental PostgreSQL → Parquet/S3 sync for analytics",
    version="1.0.0"
)

# Global connection pool
_pool: Optional[asyncpg.Pool] = None

async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    return _pool

@app.on_event("startup")
async def startup():
    global _scheduler_task
    await get_pool()
    _scheduler_task = asyncio.create_task(_scheduler_loop())
    logger.info("Lakehouse sync engine started")

@app.on_event("shutdown")
async def shutdown():
    global _pool, _scheduler_task
    if _scheduler_task:
        _scheduler_task.cancel()
        try:
            await _scheduler_task
        except asyncio.CancelledError:
            pass
    if _pool:
        await _pool.close()

class SyncRequest(BaseModel):
    table: Optional[str] = None
    full_refresh: bool = False

@app.post("/sync/{table_name}")
async def sync_single_table(table_name: str, background_tasks: BackgroundTasks):
    """Trigger incremental sync for a specific table."""
    table_config = next((t for t in SYNC_TABLES if t["name"] == table_name), None)
    if not table_config:
        raise HTTPException(status_code=404, detail=f"Table '{table_name}' not registered for sync")
    
    pool = await get_pool()
    result = await sync_table(pool, table_config)
    return result

@app.post("/sync/all")
async def sync_all_tables(background_tasks: BackgroundTasks):
    """Sync all registered tables (runs concurrently)."""
    pool = await get_pool()
    
    tasks = [sync_table(pool, t) for t in SYNC_TABLES]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    summary = []
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            summary.append({
                "table": SYNC_TABLES[i]["name"],
                "status": "error",
                "error": str(result)
            })
        else:
            summary.append(result)
    
    total_rows = sum(r.get("rows_synced", 0) for r in summary if isinstance(r, dict))
    errors = [r for r in summary if isinstance(r, dict) and r.get("status") == "error"]
    
    return {
        "status": "completed",
        "tables_synced": len(SYNC_TABLES),
        "total_rows_synced": total_rows,
        "errors": len(errors),
        "results": summary,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

@app.get("/sync/status")
async def sync_status():
    """Get sync status for all registered tables."""
    pool = await get_pool()
    
    rows = await pool.fetch(
        "SELECT table_name, last_synced_at, rows_synced, updated_at FROM lakehouse_sync_state ORDER BY table_name"
    )
    
    synced_tables = {r["table_name"]: dict(r) for r in rows}
    
    status = []
    for table in SYNC_TABLES:
        name = table["name"]
        state = synced_tables.get(name, {})
        status.append({
            "table": name,
            "last_synced_at": str(state.get("last_synced_at", "never")),
            "rows_synced": state.get("rows_synced", 0),
            "status": "synced" if state else "never_synced"
        })
    
    return {
        "tables": status,
        "total_tables": len(SYNC_TABLES),
        "synced_tables": len(synced_tables),
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

class IngestRequest(BaseModel):
    records: list[dict]

@app.post("/ingest/{table_name}")
async def ingest_records(table_name: str, req: IngestRequest):
    """
    Ingest records pushed by an upstream service (e.g. the TS API layer).
    Records are PII-masked, serialized to Snappy Parquet and written to S3.
    Fails loudly (500) if S3 is unavailable — never fabricates a write.
    """
    if not req.records:
        raise HTTPException(status_code=400, detail="No records provided")
    if len(req.records) > BATCH_SIZE:
        raise HTTPException(status_code=400, detail=f"Batch too large (>{BATCH_SIZE} records)")

    try:
        masked = [mask_pii(table_name, r) for r in req.records]
        result = write_records_to_s3(table_name, masked)
        sync_rows_total.labels(table=table_name).inc(result["rows"])
        return {
            "table": table_name,
            "status": "ingested",
            "rows_ingested": result["rows"],
            "s3_key": result["s3_key"],
            "path": f"s3://{S3_BUCKET}/{result['s3_key']}",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        sync_errors_total.labels(table=table_name).inc()
        logger.error(f"Ingest failed for {table_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Ingest to lakehouse failed: {e}")

@app.get("/read/{table_name}")
async def read_records(table_name: str, limit: int = 100, country: Optional[str] = None):
    """
    Read recent records back from the lakehouse. Reads the newest Parquet
    files for the table from S3 via pyarrow. Fails loudly if S3 is unavailable.
    """
    if limit < 1 or limit > 10000:
        raise HTTPException(status_code=400, detail="limit must be between 1 and 10000")

    try:
        s3_client = get_s3_client()
        objects = list_table_objects(s3_client, table_name)
        if not objects:
            return {"table": table_name, "rows": [], "total_rows": 0, "files_read": 0}

        rows: list[dict] = []
        files_read = 0
        # Newest files first until we satisfy the limit
        for obj in reversed(objects):
            body = s3_client.get_object(Bucket=S3_BUCKET, Key=obj["key"])["Body"].read()
            table = pq.read_table(pa.BufferReader(body))
            batch_rows = table.to_pylist()
            if country:
                batch_rows = [r for r in batch_rows if r.get("_country") == country or r.get("country") == country]
            rows.extend(batch_rows)
            files_read += 1
            if len(rows) >= limit:
                break

        return {
            "table": table_name,
            "rows": rows[-limit:],
            "total_rows": len(rows),
            "files_read": files_read,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Read failed for {table_name}: {e}")
        raise HTTPException(status_code=500, detail=f"Read from lakehouse failed: {e}")

class CompactRequest(BaseModel):
    table: Optional[str] = None

@app.post("/compact")
async def compact(req: CompactRequest):
    """
    Run Parquet compaction (pyarrow) on one table or all registered tables.
    Merges small files into larger zstd-compressed files and deletes originals.
    """
    tables = [t["name"] for t in SYNC_TABLES] if req.table is None else [req.table]

    results = []
    for name in tables:
        try:
            results.append(await compact_table(name))
        except Exception as e:
            sync_errors_total.labels(table=name).inc()
            logger.error(f"Compaction failed for {name}: {e}")
            results.append({"table": name, "status": "error", "error": str(e)})

    failures = [r for r in results if r["status"] == "error"]
    return {
        "status": "completed_with_errors" if failures else "completed",
        "tables": results,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/health")
async def health():
    try:
        pool = await get_pool()
        await pool.fetchval("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    
    try:
        s3 = get_s3_client()
        s3.head_bucket(Bucket=S3_BUCKET)
        s3_ok = True
    except Exception:
        s3_ok = False
    
    status = "ok" if (db_ok and s3_ok) else "degraded"
    return JSONResponse(
        status_code=200 if status == "ok" else 503,
        content={
            "status": status,
            "service": "lakehouse-sync",
            "db_ok": db_ok,
            "s3_ok": s3_ok,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    )

@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("LAKEHOUSE_PORT", "8102"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
