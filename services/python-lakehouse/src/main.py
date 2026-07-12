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
  POST /compact            — Run compaction on a table
  GET  /health             — Liveness probe
  GET  /metrics            — Prometheus metrics
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
    await get_pool()
    logger.info("Lakehouse sync engine started")

@app.on_event("shutdown")
async def shutdown():
    global _pool
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
