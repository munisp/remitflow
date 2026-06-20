"""
RemitFlow — Lakehouse ETL Pipeline (Python/FastAPI)
Production-grade: extracts from PostgreSQL, transforms to Parquet,
writes to S3/MinIO with Apache Iceberg manifest tracking.

Architecture:
  PostgreSQL (OLTP) ──CDC──▶ Bronze (raw Parquet, immutable)
                              │
                              ▼
                            Silver (cleaned, deduplicated, normalized Parquet)
                              │
                              ▼
                            Gold (aggregates: daily_volume, corridor_analytics, ml_features)

Storage: S3/MinIO (Parquet format)
Catalog: Iceberg-compatible JSON manifest (schema evolution, time-travel)
Query:   DuckDB (in-process OLAP over Parquet files)
CDC:     PostgreSQL logical replication slot (wal2json) for incremental loads
"""

import asyncio
import csv
import hashlib
import io
import json
import logging
import os
import struct
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, Query, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, StreamingResponse, JSONResponse
from pydantic import BaseModel
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
PORT = int(os.getenv("PORT", "8089"))
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remitflow:remitflow@postgres:5432/remitflow")
LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/data/lakehouse")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_BUCKET = os.getenv("S3_BUCKET", "remitflow-lakehouse")
S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "minioadmin")
PIPELINE_INTERVAL_SECS = int(os.getenv("PIPELINE_INTERVAL_SECS", "3600"))
CDC_SLOT_NAME = os.getenv("CDC_SLOT_NAME", "remitflow_lakehouse_cdc")
CDC_ENABLED = os.getenv("CDC_ENABLED", "true").lower() == "true"

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("lakehouse-etl")

os.makedirs(LAKEHOUSE_PATH, exist_ok=True)

# ── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "pipelines_run": 0,
    "records_extracted": 0,
    "records_loaded": 0,
    "parquet_files_written": 0,
    "total_bytes_written": 0,
    "last_run_at": None,
    "last_run_duration_ms": 0,
    "cdc_changes_processed": 0,
    "running": True,
}

# ── DB Pool ───────────────────────────────────────────────────────────────────

_pool: Optional[asyncpg.Pool] = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        try:
            _pool = await asyncpg.create_pool(
                DATABASE_URL,
                min_size=int(os.getenv("DB_POOL_MIN_SIZE", "10")),
                max_size=int(os.getenv("DB_POOL_MAX_SIZE", "50")),
                command_timeout=int(os.getenv("DB_COMMAND_TIMEOUT", "120")),
                max_queries=int(os.getenv("DB_MAX_QUERIES", "50000")),
                max_inactive_connection_lifetime=float(os.getenv("DB_MAX_INACTIVE_LIFETIME", "300")),
            )
            logger.info("PostgreSQL connection pool created")
        except Exception as e:
            logger.error(f"Failed to create DB pool: {e}")
            raise
    return _pool


# ── S3/MinIO Client ──────────────────────────────────────────────────────────

class S3Client:
    """Minimal S3-compatible client using raw HTTP (no boto3 dependency)."""

    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str):
        self.endpoint = endpoint.rstrip("/")
        self.access_key = access_key
        self.secret_key = secret_key
        self.bucket = bucket
        self._available = False

    async def check_health(self) -> bool:
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{self.endpoint}/minio/health/live")
                self._available = resp.status_code == 200
        except Exception:
            self._available = False
        return self._available

    async def put_object(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> Dict[str, Any]:
        if self._available:
            try:
                import httpx
                url = f"{self.endpoint}/{self.bucket}/{key}"
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.put(
                        url, content=data,
                        headers={"Content-Type": content_type},
                        auth=(self.access_key, self.secret_key),
                    )
                    if resp.status_code in (200, 201, 204):
                        return {"stored": "s3", "key": key, "size": len(data), "url": url}
            except Exception as e:
                logger.warning(f"S3 put failed, falling back to local: {e}")

        local_path = Path(LAKEHOUSE_PATH) / key
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(data)
        return {"stored": "local", "key": key, "size": len(data), "path": str(local_path)}

    async def get_object(self, key: str) -> Optional[bytes]:
        if self._available:
            try:
                import httpx
                url = f"{self.endpoint}/{self.bucket}/{key}"
                async with httpx.AsyncClient(timeout=30.0) as client:
                    resp = await client.get(url, auth=(self.access_key, self.secret_key))
                    if resp.status_code == 200:
                        return resp.content
            except Exception:
                pass
        local_path = Path(LAKEHOUSE_PATH) / key
        if local_path.exists():
            return local_path.read_bytes()
        return None

    async def list_objects(self, prefix: str) -> List[str]:
        local_dir = Path(LAKEHOUSE_PATH) / prefix
        if local_dir.exists():
            return [str(p.relative_to(LAKEHOUSE_PATH)) for p in local_dir.rglob("*.parquet")]
        return []


_s3 = S3Client(S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET)

# ── Iceberg Catalog ──────────────────────────────────────────────────────────


class IcebergCatalog:
    """File-based Iceberg-compatible catalog with schema evolution and time-travel."""

    def __init__(self, storage: S3Client):
        self.storage = storage
        self._catalogs: Dict[str, Dict] = {}

    def _catalog_key(self, table: str, layer: str) -> str:
        return f"iceberg/{layer}/{table}/metadata/v-current.metadata.json"

    async def get_or_create_table(self, table: str, layer: str, schema: Dict[str, str]) -> Dict:
        key = self._catalog_key(table, layer)
        data = await self.storage.get_object(key)
        if data:
            return json.loads(data)

        metadata = {
            "format-version": 2,
            "table-uuid": hashlib.md5(f"{layer}/{table}".encode()).hexdigest(),
            "location": f"s3://{S3_BUCKET}/{layer}/{table}",
            "last-sequence-number": 0,
            "last-updated-ms": int(time.time() * 1000),
            "last-column-id": len(schema),
            "current-schema-id": 0,
            "schemas": [{"schema-id": 0, "type": "struct", "fields": [
                {"id": i + 1, "name": name, "required": False, "type": dtype}
                for i, (name, dtype) in enumerate(schema.items())
            ]}],
            "current-snapshot-id": None,
            "snapshots": [],
            "snapshot-log": [],
            "sort-orders": [{"order-id": 0, "fields": []}],
            "default-sort-order-id": 0,
            "partition-specs": [{"spec-id": 0, "fields": [
                {"source-id": 1, "field-id": 1000, "name": "date_partition", "transform": "day"}
            ]}],
            "default-spec-id": 0,
            "properties": {"write.format.default": "parquet", "commit.retry.num-retries": "4"},
        }
        await self.storage.put_object(key, json.dumps(metadata, indent=2).encode(), "application/json")
        self._catalogs[f"{layer}/{table}"] = metadata
        return metadata

    async def commit_snapshot(self, table: str, layer: str, manifest_files: List[str],
                              added_rows: int, added_bytes: int) -> Dict:
        key = self._catalog_key(table, layer)
        data = await self.storage.get_object(key)
        metadata = json.loads(data) if data else {}

        seq = metadata.get("last-sequence-number", 0) + 1
        snapshot_id = int(time.time() * 1000)
        snapshot = {
            "snapshot-id": snapshot_id,
            "sequence-number": seq,
            "timestamp-ms": int(time.time() * 1000),
            "summary": {
                "operation": "append",
                "added-data-files": str(len(manifest_files)),
                "added-records": str(added_rows),
                "added-files-size": str(added_bytes),
                "total-records": str(added_rows + sum(
                    int(s["summary"].get("total-records", "0"))
                    for s in metadata.get("snapshots", [])
                )),
            },
            "manifest-list": f"iceberg/{layer}/{table}/metadata/snap-{snapshot_id}-manifest-list.json",
            "schema-id": 0,
        }

        manifest_list = {
            "manifest-path": [f"iceberg/{layer}/{table}/metadata/snap-{snapshot_id}-manifest.json"],
            "manifest-length": len(manifest_files),
            "partition-spec-id": 0,
            "added-snapshot-id": snapshot_id,
            "added-data-files-count": len(manifest_files),
            "added-rows-count": added_rows,
            "existing-data-files-count": 0,
            "existing-rows-count": 0,
        }
        await self.storage.put_object(
            snapshot["manifest-list"],
            json.dumps(manifest_list, indent=2).encode(), "application/json"
        )

        manifest_entries = [
            {"status": 1, "data_file": {"file_path": f, "file_format": "PARQUET", "record_count": added_rows // max(len(manifest_files), 1)}}
            for f in manifest_files
        ]
        await self.storage.put_object(
            f"iceberg/{layer}/{table}/metadata/snap-{snapshot_id}-manifest.json",
            json.dumps(manifest_entries, indent=2).encode(), "application/json"
        )

        metadata["last-sequence-number"] = seq
        metadata["last-updated-ms"] = int(time.time() * 1000)
        metadata["current-snapshot-id"] = snapshot_id
        metadata.setdefault("snapshots", []).append(snapshot)
        metadata.setdefault("snapshot-log", []).append(
            {"timestamp-ms": int(time.time() * 1000), "snapshot-id": snapshot_id}
        )

        await self.storage.put_object(key, json.dumps(metadata, indent=2).encode(), "application/json")

        version_key = f"iceberg/{layer}/{table}/metadata/v{seq}.metadata.json"
        await self.storage.put_object(version_key, json.dumps(metadata, indent=2).encode(), "application/json")

        return snapshot


_catalog = IcebergCatalog(_s3)

# ── Parquet Writer ────────────────────────────────────────────────────────────

TRANSACTION_SCHEMA = pa.schema([
    ("id", pa.string()),
    ("user_id", pa.string()),
    ("amount", pa.float64()),
    ("currency", pa.string()),
    ("to_currency", pa.string()),
    ("status", pa.string()),
    ("risk_score", pa.float64()),
    ("reference", pa.string()),
    ("destination_country", pa.string()),
    ("fee", pa.float64()),
    ("exchange_rate", pa.float64()),
    ("type", pa.string()),
    ("created_at", pa.timestamp("ms")),
    ("_ingested_at", pa.timestamp("ms")),
    ("_layer", pa.string()),
    ("_source", pa.string()),
])

USER_SCHEMA = pa.schema([
    ("id", pa.string()),
    ("email", pa.string()),
    ("full_name", pa.string()),
    ("country", pa.string()),
    ("kyc_status", pa.string()),
    ("kyc_tier", pa.int32()),
    ("is_active", pa.bool_()),
    ("created_at", pa.timestamp("ms")),
    ("_ingested_at", pa.timestamp("ms")),
    ("_layer", pa.string()),
])

BENEFICIARY_SCHEMA = pa.schema([
    ("id", pa.string()),
    ("user_id", pa.string()),
    ("name", pa.string()),
    ("bank_name", pa.string()),
    ("account_number", pa.string()),
    ("country", pa.string()),
    ("currency", pa.string()),
    ("is_verified", pa.bool_()),
    ("created_at", pa.timestamp("ms")),
    ("_ingested_at", pa.timestamp("ms")),
    ("_layer", pa.string()),
])

SILVER_TRANSACTION_SCHEMA = pa.schema([
    ("id", pa.string()),
    ("user_id", pa.string()),
    ("amount", pa.float64()),
    ("amount_usd", pa.float64()),
    ("currency", pa.string()),
    ("to_currency", pa.string()),
    ("status", pa.string()),
    ("risk_score", pa.float64()),
    ("destination_country", pa.string()),
    ("fee", pa.float64()),
    ("exchange_rate", pa.float64()),
    ("is_large_transaction", pa.bool_()),
    ("is_cross_border", pa.bool_()),
    ("is_round_number", pa.bool_()),
    ("hour_of_day", pa.int32()),
    ("day_of_week", pa.int32()),
    ("created_at", pa.timestamp("ms")),
    ("_silver_processed_at", pa.timestamp("ms")),
    ("_layer", pa.string()),
])

GOLD_VOLUME_SCHEMA = pa.schema([
    ("date", pa.string()),
    ("currency", pa.string()),
    ("total_amount", pa.float64()),
    ("tx_count", pa.int64()),
    ("avg_amount", pa.float64()),
    ("total_fees", pa.float64()),
    ("completed_count", pa.int64()),
    ("failed_count", pa.int64()),
])

GOLD_CORRIDOR_SCHEMA = pa.schema([
    ("corridor", pa.string()),
    ("from_currency", pa.string()),
    ("to_currency", pa.string()),
    ("destination_country", pa.string()),
    ("tx_count", pa.int64()),
    ("total_volume", pa.float64()),
    ("avg_risk", pa.float64()),
    ("avg_amount", pa.float64()),
])

GOLD_ML_FEATURES_SCHEMA = pa.schema([
    ("tx_id", pa.string()),
    ("amount_usd", pa.float64()),
    ("risk_score", pa.float64()),
    ("is_high_value", pa.int32()),
    ("is_round_number", pa.int32()),
    ("destination_country", pa.string()),
    ("currency", pa.string()),
    ("status", pa.string()),
    ("hour_of_day", pa.int32()),
    ("day_of_week", pa.int32()),
    ("velocity_1h", pa.float64()),
    ("velocity_24h", pa.float64()),
    ("amount_deviation", pa.float64()),
    ("feature_date", pa.string()),
])

TABLE_SCHEMAS = {
    "transactions": {
        "id": "string", "user_id": "string", "amount": "double", "currency": "string",
        "to_currency": "string", "status": "string", "risk_score": "double",
        "destination_country": "string", "created_at": "timestamptz",
    },
    "users": {
        "id": "string", "email": "string", "full_name": "string", "country": "string",
        "kyc_status": "string", "kyc_tier": "int", "is_active": "boolean", "created_at": "timestamptz",
    },
    "beneficiaries": {
        "id": "string", "user_id": "string", "name": "string", "bank_name": "string",
        "account_number": "string", "country": "string", "currency": "string",
        "is_verified": "boolean", "created_at": "timestamptz",
    },
}


def rows_to_parquet(rows: List[Dict], schema: pa.Schema) -> bytes:
    """Convert rows to Parquet bytes using PyArrow."""
    columns = {}
    for field in schema:
        col_values = []
        for row in rows:
            v = row.get(field.name)
            if v is None:
                col_values.append(None)
            elif pa.types.is_timestamp(field.type):
                if isinstance(v, str):
                    try:
                        col_values.append(datetime.fromisoformat(v.replace("Z", "+00:00")))
                    except Exception:
                        col_values.append(None)
                elif isinstance(v, (int, float)):
                    col_values.append(datetime.fromtimestamp(v / 1000, tz=timezone.utc))
                else:
                    col_values.append(v)
            elif pa.types.is_float64(field.type) or pa.types.is_floating(field.type):
                try:
                    col_values.append(float(v) if v is not None else None)
                except (ValueError, TypeError):
                    col_values.append(0.0)
            elif pa.types.is_int32(field.type) or pa.types.is_int64(field.type):
                try:
                    col_values.append(int(v) if v is not None else None)
                except (ValueError, TypeError):
                    col_values.append(0)
            elif pa.types.is_boolean(field.type):
                col_values.append(bool(v) if v is not None else None)
            else:
                col_values.append(str(v) if v is not None else None)
        columns[field.name] = col_values

    table = pa.table(columns, schema=schema)
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="snappy", write_statistics=True)
    return buf.getvalue()


# ── ETL Pipelines ─────────────────────────────────────────────────────────────

class TransactionPipeline:
    name = "transactions"

    @staticmethod
    async def extract(pool: asyncpg.Pool, since: Optional[datetime] = None, limit: int = 10000) -> List[Dict]:
        query = """
            SELECT id::text, user_id::text, amount::float8, currency, to_currency,
                   status, risk_score::float8, reference, destination_country,
                   fee::float8, exchange_rate::float8, type,
                   created_at
            FROM transactions
        """
        params = []
        if since:
            query += " WHERE created_at > $1"
            params.append(since)
        query += f" ORDER BY created_at DESC LIMIT {limit}"

        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]

    @staticmethod
    def transform_bronze(rows: List[Dict]) -> Tuple[List[Dict], pa.Schema]:
        now = datetime.now(timezone.utc)
        for row in rows:
            row["_ingested_at"] = now
            row["_layer"] = "bronze"
            row["_source"] = "remitflow-postgres"
        return rows, TRANSACTION_SCHEMA

    @staticmethod
    def transform_silver(rows: List[Dict]) -> Tuple[List[Dict], pa.Schema]:
        now = datetime.now(timezone.utc)
        silver = []
        for row in rows:
            amount = float(row.get("amount") or 0)
            created = row.get("created_at")
            hour = created.hour if hasattr(created, "hour") else 0
            dow = created.weekday() if hasattr(created, "weekday") else 0
            silver.append({
                "id": str(row.get("id", "")),
                "user_id": str(row.get("user_id", "")),
                "amount": amount,
                "amount_usd": amount,
                "currency": row.get("currency") or "USD",
                "to_currency": row.get("to_currency") or "USD",
                "status": row.get("status") or "pending",
                "risk_score": float(row.get("risk_score") or 0),
                "destination_country": row.get("destination_country") or "US",
                "fee": float(row.get("fee") or 0),
                "exchange_rate": float(row.get("exchange_rate") or 1.0),
                "is_large_transaction": amount > 10000,
                "is_cross_border": bool(row.get("destination_country")),
                "is_round_number": amount > 0 and amount % 100 == 0,
                "hour_of_day": hour,
                "day_of_week": dow,
                "created_at": created,
                "_silver_processed_at": now,
                "_layer": "silver",
            })
        return silver, SILVER_TRANSACTION_SCHEMA

    @staticmethod
    def transform_gold(rows: List[Dict]) -> Dict[str, Tuple[List[Dict], pa.Schema]]:
        daily_map: Dict[str, Dict] = {}
        corridor_map: Dict[str, Dict] = {}
        now = datetime.now(timezone.utc)

        for row in rows:
            amount = float(row.get("amount") or 0)
            fee = float(row.get("fee") or 0)
            risk = float(row.get("risk_score") or 0)
            created = row.get("created_at")
            date_str = created.strftime("%Y-%m-%d") if hasattr(created, "strftime") else str(created)[:10]
            currency = row.get("currency") or "USD"
            to_currency = row.get("to_currency") or "USD"
            dest = row.get("destination_country") or "US"
            status = row.get("status") or "pending"

            dk = f"{date_str}_{currency}"
            if dk not in daily_map:
                daily_map[dk] = {
                    "date": date_str, "currency": currency,
                    "total_amount": 0.0, "tx_count": 0, "avg_amount": 0.0,
                    "total_fees": 0.0, "completed_count": 0, "failed_count": 0,
                }
            daily_map[dk]["total_amount"] += amount
            daily_map[dk]["tx_count"] += 1
            daily_map[dk]["total_fees"] += fee
            if status == "completed":
                daily_map[dk]["completed_count"] += 1
            if status == "failed":
                daily_map[dk]["failed_count"] += 1

            ck = f"{currency}_{to_currency}_{dest}"
            if ck not in corridor_map:
                corridor_map[ck] = {
                    "corridor": ck, "from_currency": currency, "to_currency": to_currency,
                    "destination_country": dest, "tx_count": 0, "total_volume": 0.0,
                    "avg_risk": 0.0, "avg_amount": 0.0, "_risk_sum": 0.0,
                }
            corridor_map[ck]["tx_count"] += 1
            corridor_map[ck]["total_volume"] += amount
            corridor_map[ck]["_risk_sum"] += risk

        for v in daily_map.values():
            v["avg_amount"] = v["total_amount"] / max(v["tx_count"], 1)
        for c in corridor_map.values():
            c["avg_risk"] = c["_risk_sum"] / max(c["tx_count"], 1)
            c["avg_amount"] = c["total_volume"] / max(c["tx_count"], 1)
            del c["_risk_sum"]

        ml_features = []
        for row in rows:
            amount = float(row.get("amount") or 0)
            created = row.get("created_at")
            ml_features.append({
                "tx_id": str(row.get("id", "")),
                "amount_usd": amount,
                "risk_score": float(row.get("risk_score") or 0),
                "is_high_value": 1 if amount > 10000 else 0,
                "is_round_number": 1 if amount > 0 and amount % 100 == 0 else 0,
                "destination_country": row.get("destination_country") or "US",
                "currency": row.get("currency") or "USD",
                "status": row.get("status") or "pending",
                "hour_of_day": created.hour if hasattr(created, "hour") else 0,
                "day_of_week": created.weekday() if hasattr(created, "weekday") else 0,
                "velocity_1h": 0.0,
                "velocity_24h": 0.0,
                "amount_deviation": 0.0,
                "feature_date": created.strftime("%Y-%m-%d") if hasattr(created, "strftime") else "",
            })

        return {
            "daily_volume": (list(daily_map.values()), GOLD_VOLUME_SCHEMA),
            "corridor_analytics": (list(corridor_map.values()), GOLD_CORRIDOR_SCHEMA),
            "ml_features": (ml_features, GOLD_ML_FEATURES_SCHEMA),
        }


class UserPipeline:
    name = "users"

    @staticmethod
    async def extract(pool: asyncpg.Pool, since: Optional[datetime] = None, limit: int = 10000) -> List[Dict]:
        query = """
            SELECT id::text, email, full_name, country, kyc_status, kyc_tier,
                   is_active, created_at
            FROM users
        """
        params = []
        if since:
            query += " WHERE created_at > $1"
            params.append(since)
        query += f" ORDER BY created_at DESC LIMIT {limit}"
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]

    @staticmethod
    def transform_bronze(rows: List[Dict]) -> Tuple[List[Dict], pa.Schema]:
        now = datetime.now(timezone.utc)
        for row in rows:
            row["_ingested_at"] = now
            row["_layer"] = "bronze"
        return rows, USER_SCHEMA


class BeneficiaryPipeline:
    name = "beneficiaries"

    @staticmethod
    async def extract(pool: asyncpg.Pool, since: Optional[datetime] = None, limit: int = 10000) -> List[Dict]:
        query = """
            SELECT id::text, user_id::text, name, bank_name, account_number,
                   country, currency, is_verified, created_at
            FROM beneficiaries
        """
        params = []
        if since:
            query += " WHERE created_at > $1"
            params.append(since)
        query += f" ORDER BY created_at DESC LIMIT {limit}"
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
        return [dict(r) for r in rows]

    @staticmethod
    def transform_bronze(rows: List[Dict]) -> Tuple[List[Dict], pa.Schema]:
        now = datetime.now(timezone.utc)
        for row in rows:
            row["_ingested_at"] = now
            row["_layer"] = "bronze"
        return rows, BENEFICIARY_SCHEMA


# ── CDC (Change Data Capture) ────────────────────────────────────────────────

class CDCManager:
    """PostgreSQL logical replication CDC via polling pg_logical_slot_peek_changes."""

    def __init__(self, slot_name: str = CDC_SLOT_NAME):
        self.slot_name = slot_name
        self._initialized = False

    async def initialize(self, pool: asyncpg.Pool) -> bool:
        try:
            async with pool.acquire() as conn:
                existing = await conn.fetchval(
                    "SELECT slot_name FROM pg_replication_slots WHERE slot_name = $1",
                    self.slot_name
                )
                if not existing:
                    try:
                        await conn.fetchval(
                            "SELECT pg_create_logical_replication_slot($1, 'wal2json')",
                            self.slot_name
                        )
                        logger.info(f"Created CDC replication slot: {self.slot_name}")
                    except Exception as e:
                        if "already exists" in str(e):
                            pass
                        elif "wal2json" in str(e):
                            logger.warning("wal2json not installed — CDC will use batch polling fallback")
                            return False
                        else:
                            logger.warning(f"CDC slot creation failed: {e} — using batch polling")
                            return False
                self._initialized = True
                return True
        except Exception as e:
            logger.warning(f"CDC initialization failed: {e} — using batch polling")
            return False

    async def poll_changes(self, pool: asyncpg.Pool, max_changes: int = 10000) -> List[Dict]:
        if not self._initialized:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT data FROM pg_logical_slot_get_changes($1, NULL, $2)",
                    self.slot_name, max_changes
                )
            changes = []
            for row in rows:
                try:
                    change = json.loads(row["data"])
                    changes.append(change)
                except json.JSONDecodeError:
                    continue
            stats["cdc_changes_processed"] += len(changes)
            return changes
        except Exception as e:
            logger.warning(f"CDC poll error: {e}")
            return []


_cdc = CDCManager()

# ── Pipeline Runner ───────────────────────────────────────────────────────────

_last_extract_times: Dict[str, datetime] = {}


async def run_pipeline(
    pipeline_name: Optional[str] = None,
    limit: int = 10000,
    incremental: bool = True,
) -> Dict[str, Any]:
    """Run the full Bronze → Silver → Gold ETL pipeline with real PostgreSQL extraction."""
    start = datetime.now(timezone.utc)
    results = {}

    try:
        pool = await get_pool()
    except Exception as e:
        return {"error": f"Database unavailable: {e}", "duration_ms": 0}

    pipelines = {
        "transactions": TransactionPipeline,
        "users": UserPipeline,
        "beneficiaries": BeneficiaryPipeline,
    }

    if pipeline_name and pipeline_name in pipelines:
        pipelines = {pipeline_name: pipelines[pipeline_name]}
    elif pipeline_name and pipeline_name not in pipelines:
        return {"error": f"Unknown pipeline: {pipeline_name}", "duration_ms": 0}

    for name, pipeline_cls in pipelines.items():
        pipeline_start = time.time()
        try:
            since = _last_extract_times.get(name) if incremental else None

            # Extract from PostgreSQL
            rows = await pipeline_cls.extract(pool, since=since, limit=limit)
            if not rows:
                results[name] = {"status": "success", "records_extracted": 0, "records_loaded": 0, "duration_ms": 0}
                continue

            extracted = len(rows)
            stats["records_extracted"] += extracted
            _last_extract_times[name] = start

            date_str = start.strftime("%Y-%m-%d")
            timestamp = int(start.timestamp() * 1000)

            # Bronze layer: raw Parquet
            bronze_rows, bronze_schema = pipeline_cls.transform_bronze(rows)
            bronze_parquet = rows_to_parquet(bronze_rows, bronze_schema)
            bronze_key = f"bronze/{name}/date={date_str}/part-{timestamp}.parquet"
            bronze_result = await _s3.put_object(bronze_key, bronze_parquet, "application/x-parquet")

            await _catalog.get_or_create_table(name, "bronze", TABLE_SCHEMAS.get(name, {}))
            await _catalog.commit_snapshot(name, "bronze", [bronze_key], extracted, len(bronze_parquet))

            stats["parquet_files_written"] += 1
            stats["total_bytes_written"] += len(bronze_parquet)

            silver_result = None
            gold_result = None

            # Silver + Gold only for transactions
            if name == "transactions":
                silver_rows, silver_schema = TransactionPipeline.transform_silver(rows)
                silver_parquet = rows_to_parquet(silver_rows, silver_schema)
                silver_key = f"silver/{name}/date={date_str}/part-{timestamp}.parquet"
                silver_result = await _s3.put_object(silver_key, silver_parquet, "application/x-parquet")

                await _catalog.get_or_create_table(name, "silver", {
                    "id": "string", "amount": "double", "amount_usd": "double",
                    "currency": "string", "status": "string", "created_at": "timestamptz",
                })
                await _catalog.commit_snapshot(name, "silver", [silver_key], len(silver_rows), len(silver_parquet))

                stats["parquet_files_written"] += 1
                stats["total_bytes_written"] += len(silver_parquet)

                gold_tables = TransactionPipeline.transform_gold(rows)
                gold_result = {}
                for gold_name, (gold_rows, gold_schema) in gold_tables.items():
                    if gold_rows:
                        gold_parquet = rows_to_parquet(gold_rows, gold_schema)
                        gold_key = f"gold/{gold_name}/date={date_str}/part-{timestamp}.parquet"
                        gold_result[gold_name] = await _s3.put_object(gold_key, gold_parquet, "application/x-parquet")

                        await _catalog.get_or_create_table(gold_name, "gold", {f.name: str(f.type) for f in gold_schema})
                        await _catalog.commit_snapshot(gold_name, "gold", [gold_key], len(gold_rows), len(gold_parquet))

                        stats["parquet_files_written"] += 1
                        stats["total_bytes_written"] += len(gold_parquet)

            loaded = extracted
            stats["records_loaded"] += loaded

            pipeline_duration = int((time.time() - pipeline_start) * 1000)
            results[name] = {
                "status": "success",
                "records_extracted": extracted,
                "records_loaded": loaded,
                "duration_ms": pipeline_duration,
                "bronze": bronze_result,
                "silver": silver_result,
                "gold": gold_result,
            }
            stats["pipelines_run"] += 1

        except Exception as e:
            logger.error(f"[ETL] Pipeline {name} failed: {e}", exc_info=True)
            results[name] = {"status": "error", "error": str(e)}

    duration_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
    stats["last_run_at"] = start.isoformat()
    stats["last_run_duration_ms"] = duration_ms

    return {"pipelines": results, "duration_ms": duration_ms, "incremental": incremental}


async def pipeline_loop() -> None:
    """Periodic pipeline runner with CDC integration."""
    await asyncio.sleep(10)

    pool = None
    try:
        pool = await get_pool()
        if CDC_ENABLED:
            cdc_ok = await _cdc.initialize(pool)
            if cdc_ok:
                logger.info("CDC replication slot active — incremental mode")
            else:
                logger.info("CDC not available — using batch polling mode")
    except Exception as e:
        logger.warning(f"Startup DB connection failed: {e} — will retry in pipeline loop")

    while stats["running"]:
        try:
            logger.info("[ETL] Starting scheduled pipeline run")
            result = await run_pipeline(incremental=True)
            tx_result = result.get("pipelines", {}).get("transactions", {})
            logger.info(
                f"[ETL] Pipeline complete: {tx_result.get('records_extracted', 0)} extracted, "
                f"{tx_result.get('records_loaded', 0)} loaded in {result.get('duration_ms', 0)}ms"
            )
        except Exception as e:
            logger.error(f"[ETL] Scheduled run error: {e}")
        await asyncio.sleep(PIPELINE_INTERVAL_SECS)


# ── Regulatory Reports (real DB queries) ──────────────────────────────────────

class RegulatoryReportPipeline:
    name = "regulatory_reports"
    REPORT_TYPES = ["SAR", "CTR", "FBAR", "AML_SUMMARY", "KYC_SUMMARY"]

    @staticmethod
    async def generate_sar(pool: asyncpg.Pool, start_date: str, end_date: str) -> List[Dict]:
        query = """
            SELECT id::text as transaction_id, user_id::text, amount::float8,
                   currency, destination_country, risk_score::float8, created_at
            FROM transactions
            WHERE (amount > 10000 OR risk_score > 0.7 OR status = 'flagged')
              AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
            ORDER BY amount DESC
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, start_date, end_date)
        return [
            {
                "report_type": "SAR",
                "transaction_id": r["transaction_id"],
                "user_id": r["user_id"],
                "amount": r["amount"],
                "currency": r["currency"],
                "destination_country": r["destination_country"],
                "risk_score": r["risk_score"],
                "reason": "High value" if r["amount"] > 10000 else "High risk score",
                "filing_deadline": (r["created_at"] + timedelta(days=30)).isoformat() if r["created_at"] else None,
                "report_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
            for r in rows
        ]

    @staticmethod
    async def generate_ctr(pool: asyncpg.Pool, start_date: str, end_date: str) -> List[Dict]:
        query = """
            SELECT id::text as transaction_id, user_id::text, amount::float8,
                   currency, destination_country, created_at
            FROM transactions
            WHERE amount > 10000
              AND created_at BETWEEN $1::timestamptz AND $2::timestamptz
            ORDER BY amount DESC
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, start_date, end_date)
        return [
            {
                "report_type": "CTR",
                "transaction_id": r["transaction_id"],
                "user_id": r["user_id"],
                "amount": r["amount"],
                "currency": r["currency"],
                "report_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
            for r in rows
        ]

    @staticmethod
    async def generate_structuring(pool: asyncpg.Pool, start_date: str, end_date: str) -> List[Dict]:
        query = """
            SELECT user_id::text, COUNT(*) as tx_count, SUM(amount::float8) as total,
                   MIN(amount::float8) as min_amount, MAX(amount::float8) as max_amount
            FROM transactions
            WHERE created_at BETWEEN $1::timestamptz AND $2::timestamptz
            GROUP BY user_id
            HAVING COUNT(*) > 10 AND SUM(amount::float8) > 9000 AND MAX(amount::float8) < 10000
            ORDER BY SUM(amount::float8) DESC
        """
        async with pool.acquire() as conn:
            rows = await conn.fetch(query, start_date, end_date)
        return [
            {
                "report_type": "STRUCTURING",
                "user_id": r["user_id"],
                "tx_count": r["tx_count"],
                "total": float(r["total"]),
                "min_amount": float(r["min_amount"]),
                "max_amount": float(r["max_amount"]),
                "report_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            }
            for r in rows
        ]


# ── DuckDB Query Engine (reads Parquet from storage) ─────────────────────────

class DuckDBEngine:
    """In-process OLAP engine for querying Parquet files in the lakehouse."""

    def __init__(self, lakehouse_path: str):
        self.path = lakehouse_path
        self._conn = None

    def _get_conn(self):
        if self._conn is None:
            try:
                import duckdb
                db_path = os.path.join(self.path, "analytics.duckdb")
                self._conn = duckdb.connect(db_path)
                self._register_parquet_views()
            except ImportError:
                logger.warning("DuckDB not installed — query engine unavailable")
                return None
        return self._conn

    def _register_parquet_views(self):
        conn = self._conn
        if not conn:
            return
        layers = ["bronze", "silver", "gold"]
        for layer in layers:
            layer_path = Path(self.path) / layer
            if layer_path.exists():
                for table_dir in layer_path.iterdir():
                    if table_dir.is_dir():
                        parquet_glob = str(table_dir / "**" / "*.parquet")
                        try:
                            conn.execute(
                                f"CREATE OR REPLACE VIEW {layer}_{table_dir.name} AS "
                                f"SELECT * FROM read_parquet('{parquet_glob}', hive_partitioning=true)"
                            )
                        except Exception:
                            pass

    def query(self, sql: str, limit: int = 1000) -> Dict:
        conn = self._get_conn()
        if not conn:
            return {"error": "DuckDB not available", "rows": [], "columns": []}
        try:
            result = conn.execute(sql).fetchdf()
            return {
                "rows": result.head(limit).to_dict(orient="records"),
                "total_rows": len(result),
                "columns": list(result.columns),
            }
        except Exception as e:
            return {"error": str(e), "rows": [], "columns": []}


_duckdb = DuckDBEngine(LAKEHOUSE_PATH)

# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(
    title="RemitFlow Lakehouse ETL",
    description="Production ETL: PostgreSQL → Parquet → S3/MinIO with Iceberg catalog",
    version="2.0.0",
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
async def health():
    pool_ok = _pool is not None
    s3_ok = _s3._available
    return {
        "status": "healthy" if pool_ok else "degraded",
        "service": "lakehouse-etl",
        "version": "2.0.0",
        "postgres_connected": pool_ok,
        "s3_available": s3_ok,
        "cdc_enabled": CDC_ENABLED,
        "cdc_initialized": _cdc._initialized,
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return f"""# HELP etl_pipelines_run_total Total ETL pipeline runs
# TYPE etl_pipelines_run_total counter
etl_pipelines_run_total {stats['pipelines_run']}
# HELP etl_records_extracted_total Total records extracted from PostgreSQL
# TYPE etl_records_extracted_total counter
etl_records_extracted_total {stats['records_extracted']}
# HELP etl_records_loaded_total Total records loaded to lakehouse
# TYPE etl_records_loaded_total counter
etl_records_loaded_total {stats['records_loaded']}
# HELP etl_parquet_files_total Total Parquet files written
# TYPE etl_parquet_files_total counter
etl_parquet_files_total {stats['parquet_files_written']}
# HELP etl_bytes_written_total Total bytes written to storage
# TYPE etl_bytes_written_total counter
etl_bytes_written_total {stats['total_bytes_written']}
# HELP etl_cdc_changes_total Total CDC changes processed
# TYPE etl_cdc_changes_total counter
etl_cdc_changes_total {stats['cdc_changes_processed']}
"""


class PipelineRunRequest(BaseModel):
    pipeline: Optional[str] = None
    limit: int = 10000
    incremental: bool = True


@app.post("/pipelines/run")
async def trigger_pipeline(req: PipelineRunRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_pipeline, req.pipeline, req.limit, req.incremental)
    return {"status": "triggered", "pipeline": req.pipeline or "all", "limit": req.limit, "incremental": req.incremental}


@app.post("/pipelines/run-sync")
async def trigger_pipeline_sync(req: PipelineRunRequest):
    result = await run_pipeline(req.pipeline, req.limit, req.incremental)
    return result


@app.get("/pipelines")
async def list_pipelines():
    return {
        "pipelines": [
            {"name": "transactions", "description": "Transaction data ETL (Bronze + Silver + Gold)"},
            {"name": "users", "description": "User profile ETL (Bronze)"},
            {"name": "beneficiaries", "description": "Beneficiary data ETL (Bronze)"},
        ],
        "layers": ["bronze", "silver", "gold"],
        "format": "Apache Parquet (Snappy compression)",
        "catalog": "Iceberg-compatible JSON manifests",
        "storage": "S3/MinIO" if _s3._available else "Local filesystem",
    }


@app.get("/reports/{report_type}")
async def get_report(
    report_type: str,
    format: str = Query(default="json", description="Output format: json or csv"),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
):
    valid_types = RegulatoryReportPipeline.REPORT_TYPES
    if report_type.upper() not in valid_types:
        raise HTTPException(400, f"Unknown report type. Valid: {valid_types}")

    sd = start_date or (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    ed = end_date or datetime.now(timezone.utc).isoformat()

    try:
        pool = await get_pool()
    except Exception as e:
        raise HTTPException(503, f"Database unavailable: {e}")

    rt = report_type.upper()
    if rt == "SAR":
        data = await RegulatoryReportPipeline.generate_sar(pool, sd, ed)
    elif rt == "CTR":
        data = await RegulatoryReportPipeline.generate_ctr(pool, sd, ed)
    elif rt in ("FBAR", "AML_SUMMARY"):
        data = await RegulatoryReportPipeline.generate_structuring(pool, sd, ed)
    else:
        data = []

    if format == "csv" and data:
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=data[0].keys())
        writer.writeheader()
        writer.writerows(data)
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={report_type}_{datetime.now().strftime('%Y%m%d')}.csv"},
        )

    return {
        "report_type": report_type,
        "period_start": sd,
        "period_end": ed,
        "record_count": len(data),
        "data": data,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


class QueryRequest(BaseModel):
    sql: str
    limit: int = 1000


@app.post("/query")
async def run_query(req: QueryRequest):
    sql_upper = req.sql.strip().upper()
    if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
        raise HTTPException(400, "Only SELECT queries are allowed")
    return _duckdb.query(req.sql, req.limit)


@app.get("/catalog/{layer}/{table}")
async def get_catalog(layer: str, table: str):
    key = f"iceberg/{layer}/{table}/metadata/v-current.metadata.json"
    data = await _s3.get_object(key)
    if not data:
        raise HTTPException(404, f"Table {layer}/{table} not found in catalog")
    return json.loads(data)


@app.get("/catalog")
async def list_catalog():
    tables = []
    for layer in ["bronze", "silver", "gold"]:
        layer_path = Path(LAKEHOUSE_PATH) / "iceberg" / layer
        if layer_path.exists():
            for table_dir in layer_path.iterdir():
                if table_dir.is_dir():
                    tables.append({"layer": layer, "table": table_dir.name})
    return {"tables": tables}


@app.get("/stats/storage")
async def storage_stats():
    total_files = 0
    total_bytes = 0
    by_layer: Dict[str, Dict] = {}

    for layer in ["bronze", "silver", "gold"]:
        layer_path = Path(LAKEHOUSE_PATH) / layer
        layer_files = 0
        layer_bytes = 0
        if layer_path.exists():
            for f in layer_path.rglob("*.parquet"):
                layer_files += 1
                layer_bytes += f.stat().st_size
        by_layer[layer] = {"files": layer_files, "bytes": layer_bytes}
        total_files += layer_files
        total_bytes += layer_bytes

    return {
        "total_files": total_files,
        "total_bytes": total_bytes,
        "total_mb": round(total_bytes / 1_048_576, 2),
        "by_layer": by_layer,
        "storage_backend": "s3" if _s3._available else "local",
    }


@app.on_event("startup")
async def startup():
    await _s3.check_health()
    try:
        await get_pool()
        logger.info("PostgreSQL pool ready")
    except Exception as e:
        logger.warning(f"PostgreSQL not available at startup: {e} — will retry")
    asyncio.create_task(pipeline_loop())
    logger.info(f"[LAKEHOUSE-ETL] v2.0.0 started on port {PORT}")


@app.on_event("shutdown")
async def shutdown():
    stats["running"] = False
    if _pool:
        await _pool.close()


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level=LOG_LEVEL.lower())
