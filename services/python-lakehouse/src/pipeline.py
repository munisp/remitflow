"""
RemitFlow — Lakehouse Data Pipeline
════════════════════════════════════════════════════════════════════════════════
Ingests operational data from PostgreSQL into the lakehouse for
analytics, ML model training, and regulatory reporting.

Architecture:
    PostgreSQL (OLTP) → Python Pipeline → Parquet files (LAKEHOUSE_PATH / S3-MinIO)
                                        → Delta Lake tables (only if the optional
                                          `deltalake` package is installed; otherwise
                                          plain Parquet, logged explicitly)

NOTE: There is NO Kafka CDC consumer mode in this pipeline. Streaming ingestion
is handled by the main sync engine (main.py) plus Kafka consumers elsewhere in
the platform. This CLI supports batch modes only.

Tables ingested:
    - transfers         → <lakehouse>/transfers/
    - fx_rates          → <lakehouse>/fx_rates/

Usage:
    python pipeline.py --mode=full_load --table=transfers
    python pipeline.py --mode=incremental --table=all
    python pipeline.py --mode=stats
"""

import os
import sys
import json
import logging
import argparse
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional, Generator
import time

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","service":"python-lakehouse","msg":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
logger = logging.getLogger("lakehouse")

# ── Configuration ─────────────────────────────────────────────────────────────

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known defaults."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-lakehouse] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure S3/MinIO credentials explicitly."
        )
    return value

DB_URL = _require_env("DATABASE_URL")
LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/data/lakehouse")
S3_BUCKET = os.getenv("S3_BUCKET", "remitflow-lakehouse")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_ACCESS_KEY = _require_env("S3_ACCESS_KEY")
S3_SECRET_KEY = _require_env("S3_SECRET_KEY")
BATCH_SIZE = int(os.getenv("BATCH_SIZE", "10000"))
INCREMENTAL_LOOKBACK_HOURS = int(os.getenv("INCREMENTAL_LOOKBACK_HOURS", "2"))

# ── PII Masking ───────────────────────────────────────────────────────────────

PII_SALT = _require_env("PII_SALT")

def mask_pii(value: Optional[str], field_type: str = "generic") -> Optional[str]:
    """One-way pseudonymization of PII fields for analytics."""
    if value is None:
        return None
    hash_input = f"{field_type}:{value}:{PII_SALT}"
    return "PII-" + hashlib.sha256(hash_input.encode()).hexdigest()[:16].upper()

def mask_email(email: Optional[str]) -> Optional[str]:
    if not email or "@" not in email:
        return mask_pii(email, "email")
    local, domain = email.split("@", 1)
    masked_local = local[:2] + "***" if len(local) > 2 else "***"
    return f"{masked_local}@{domain}"

def mask_phone(phone: Optional[str]) -> Optional[str]:
    if not phone:
        return None
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) >= 4:
        return digits[:3] + "****" + digits[-2:]
    return "****"

# ── Schema Definitions ────────────────────────────────────────────────────────

TRANSFER_SCHEMA = {
    "id": "string",
    # Pseudonymized identifier (PII_SALT-keyed) — raw user_id is never exported
    # to the analytics store (PY-016 remediation).
    "user_id_hash": "string",
    "amount": "float64",
    "send_currency": "string",
    "receive_currency": "string",
    "status": "string",
    "provider": "string",
    "corridor": "string",
    "fee_usd": "float64",
    "fx_rate": "float64",
    "recipient_receives": "float64",
    "created_at": "timestamp",
    "completed_at": "timestamp",
    "tigerbeetle_transfer_id": "string",
    # Derived fields
    "year": "int32",
    "month": "int32",
    "day": "int32",
    "hour": "int32",
}

USER_SCHEMA = {
    "id": "int64",
    "user_id_hash": "string",       # pseudonymized
    "email_masked": "string",       # masked
    "phone_masked": "string",       # masked
    "country": "string",
    "kyc_tier": "string",
    "account_status": "string",
    "created_at": "timestamp",
    "last_active_at": "timestamp",
}

FX_RATE_SCHEMA = {
    "id": "string",
    "base_currency": "string",
    "quote_currency": "string",
    "rate": "float64",
    "bid": "float64",
    "ask": "float64",
    "spread_bps": "float64",
    "provider": "string",
    "timestamp": "timestamp",
}

# ── Data Extractors ───────────────────────────────────────────────────────────

class PostgresExtractor:
    """Extracts data from PostgreSQL in batches."""

    def __init__(self, db_url: str):
        self.db_url = db_url
        self._conn = None

    def connect(self):
        """Connect to PostgreSQL. Fails loudly — no mock/fabricated data fallback."""
        try:
            import psycopg2
        except ImportError as e:
            raise RuntimeError(
                "psycopg2 is required for the lakehouse pipeline but is not installed. "
                "Install psycopg2-binary (see requirements.txt). Refusing to emit fabricated data."
            ) from e
        try:
            self._conn = psycopg2.connect(self.db_url)
            logger.info("Connected to PostgreSQL")
        except Exception as e:
            raise RuntimeError(
                f"PostgreSQL connection failed ({e}). Refusing to emit fabricated data — "
                "fix the database connection and retry."
            ) from e

    def extract_transfers(
        self,
        since: Optional[datetime] = None,
        limit: int = BATCH_SIZE
    ) -> Generator[list, None, None]:
        """Extract transfers in batches."""
        if self._conn is None:
            raise RuntimeError("extract_transfers called before connect() — no database connection")

        cursor = self._conn.cursor()
        offset = 0
        where = f"WHERE created_at >= '{since.isoformat()}'" if since else ""

        while True:
            cursor.execute(f"""
                SELECT id, user_id, amount, send_currency, receive_currency,
                       status, provider, fee_usd, fx_rate, recipient_receives,
                       created_at, completed_at, tigerbeetle_transfer_id
                FROM transfers
                {where}
                ORDER BY created_at ASC
                LIMIT {limit} OFFSET {offset}
            """)
            rows = cursor.fetchall()
            if not rows:
                break
            yield rows
            offset += limit
            if len(rows) < limit:
                break

    def extract_fx_rates(
        self,
        since: Optional[datetime] = None
    ) -> Generator[list, None, None]:
        """Extract FX rate snapshots."""
        if self._conn is None:
            raise RuntimeError("extract_fx_rates called before connect() — no database connection")

        cursor = self._conn.cursor()
        where = f"WHERE timestamp >= '{since.isoformat()}'" if since else ""
        cursor.execute(f"""
            SELECT id, base_currency, quote_currency, rate, bid, ask, provider, timestamp
            FROM fx_rates
            {where}
            ORDER BY timestamp ASC
            LIMIT 100000
        """)
        rows = cursor.fetchall()
        if rows:
            yield rows


# ── Data Transformers ─────────────────────────────────────────────────────────

def transform_transfer_row(row: tuple) -> dict:
    """Transform a raw transfer row into the analytics schema."""
    (id_, user_id, amount, send_ccy, recv_ccy, status, provider,
     fee_usd, fx_rate, recipient_receives, created_at, completed_at, tb_id) = row

    created_dt = created_at if isinstance(created_at, datetime) else datetime.fromisoformat(str(created_at))

    return {
        "id": str(id_),
        "user_id_hash": mask_pii(str(user_id), "user_id"),
        "amount": float(amount or 0),
        "send_currency": str(send_ccy),
        "receive_currency": str(recv_ccy),
        "status": str(status),
        "provider": str(provider or "unknown"),
        "corridor": f"{send_ccy}-{recv_ccy}",
        "fee_usd": float(fee_usd or 0),
        "fx_rate": float(fx_rate or 0),
        "recipient_receives": float(recipient_receives or 0),
        "created_at": created_dt.isoformat(),
        "completed_at": completed_at.isoformat() if completed_at else None,
        "tigerbeetle_transfer_id": str(tb_id) if tb_id else None,
        # Derived time partitions
        "year": created_dt.year,
        "month": created_dt.month,
        "day": created_dt.day,
        "hour": created_dt.hour,
    }

def transform_fx_rate_row(row: tuple) -> dict:
    """Transform a raw FX rate row into the analytics schema."""
    (id_, base, quote, rate, bid, ask, provider, timestamp) = row
    ts = timestamp if isinstance(timestamp, datetime) else datetime.fromisoformat(str(timestamp))
    spread_bps = ((ask - bid) / rate * 10000) if rate > 0 else 0

    return {
        "id": str(id_),
        "base_currency": str(base),
        "quote_currency": str(quote),
        "rate": float(rate),
        "bid": float(bid or rate),
        "ask": float(ask or rate),
        "spread_bps": round(float(spread_bps), 2),
        "provider": str(provider or "unknown"),
        "timestamp": ts.isoformat(),
    }

# ── Delta Lake Writer ─────────────────────────────────────────────────────────

class DeltaWriter:
    """Writes transformed data to Delta Lake format."""

    def __init__(self, base_path: str):
        self.base_path = base_path
        self._delta_available = False
        try:
            import deltalake  # noqa
            self._delta_available = True
            logger.info("Delta Lake (deltalake) available")
        except ImportError:
            logger.warning("deltalake not installed — writing Parquet files instead")

    def write_batch(self, table: str, records: list[dict], mode: str = "append") -> int:
        """Write a batch of records to the Delta table."""
        if not records:
            return 0

        table_path = f"{self.base_path}/{table}"
        os.makedirs(table_path, exist_ok=True)

        if self._delta_available:
            return self._write_delta(table_path, records, mode)
        else:
            return self._write_parquet(table_path, records)

    def _write_delta(self, path: str, records: list[dict], mode: str) -> int:
        try:
            import pyarrow as pa
            from deltalake.writer import write_deltalake

            # Convert to PyArrow table
            table = pa.Table.from_pylist(records)
            write_deltalake(path, table, mode=mode)
            logger.info(f"Wrote {len(records)} records to Delta table at {path}")
            return len(records)
        except Exception as e:
            logger.error(f"Delta write failed: {e}")
            return self._write_parquet(path, records)

    def _write_parquet(self, path: str, records: list[dict]) -> int:
        """Fallback: write as Parquet files."""
        try:
            import pyarrow as pa
            import pyarrow.parquet as pq

            ts = int(time.time())
            file_path = f"{path}/data_{ts}.parquet"
            table = pa.Table.from_pylist(records)
            pq.write_table(table, file_path, compression="snappy")
            logger.info(f"Wrote {len(records)} records to Parquet at {file_path}")
            return len(records)
        except ImportError:
            # Last resort: write JSON
            ts = int(time.time())
            file_path = f"{path}/data_{ts}.jsonl"
            with open(file_path, "w") as f:
                for record in records:
                    f.write(json.dumps(record) + "\n")
            logger.info(f"Wrote {len(records)} records to JSONL at {file_path}")
            return len(records)
        except Exception as e:
            logger.error(f"Parquet write failed: {e}")
            return 0

# ── Pipeline Orchestrator ─────────────────────────────────────────────────────

class LakehousePipeline:
    """Orchestrates the full ETL pipeline."""

    def __init__(self):
        self.extractor = PostgresExtractor(DB_URL)
        self.writer = DeltaWriter(LAKEHOUSE_PATH)

    def run_full_load(self, table: str = "all") -> dict:
        """Run a full historical load for the specified table(s)."""
        self.extractor.connect()
        results = {}

        tables = ["transfers", "fx_rates"] if table == "all" else [table]

        for t in tables:
            count = self._load_table(t, since=None)
            results[t] = count
            logger.info(f"Full load complete for {t}: {count} records")

        return results

    def run_incremental(self, table: str = "all") -> dict:
        """Run an incremental load for the last N hours."""
        self.extractor.connect()
        since = datetime.now(timezone.utc) - timedelta(hours=INCREMENTAL_LOOKBACK_HOURS)
        results = {}

        tables = ["transfers", "fx_rates"] if table == "all" else [table]

        for t in tables:
            count = self._load_table(t, since=since)
            results[t] = count
            logger.info(f"Incremental load complete for {t}: {count} records since {since.isoformat()}")

        return results

    def _load_table(self, table: str, since: Optional[datetime]) -> int:
        total = 0

        if table == "transfers":
            for batch in self.extractor.extract_transfers(since=since):
                transformed = [transform_transfer_row(row) for row in batch]
                written = self.writer.write_batch("transfers", transformed)
                total += written

        elif table == "fx_rates":
            for batch in self.extractor.extract_fx_rates(since=since):
                transformed = [transform_fx_rate_row(row) for row in batch]
                written = self.writer.write_batch("fx_rates", transformed)
                total += written

        return total

    def get_stats(self) -> dict:
        """Return pipeline statistics."""
        stats = {}
        for table in ["transfers", "fx_rates"]:
            path = f"{LAKEHOUSE_PATH}/{table}"
            if os.path.exists(path):
                files = [f for f in os.listdir(path) if f.endswith((".parquet", ".jsonl"))]
                stats[table] = {"files": len(files), "path": path}
            else:
                stats[table] = {"files": 0, "path": path}
        return stats

# ── CLI Entry Point ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="RemitFlow Lakehouse Pipeline")
    parser.add_argument("--mode", choices=["full_load", "incremental", "stats"], default="incremental")
    parser.add_argument("--table", default="all", help="Table to load: transfers, fx_rates, or all")
    args = parser.parse_args()

    pipeline = LakehousePipeline()

    if args.mode == "full_load":
        logger.info(f"Starting full load for table: {args.table}")
        results = pipeline.run_full_load(args.table)
        logger.info(f"Full load results: {results}")

    elif args.mode == "incremental":
        logger.info(f"Starting incremental load for table: {args.table}")
        results = pipeline.run_incremental(args.table)
        logger.info(f"Incremental load results: {results}")

    elif args.mode == "stats":
        stats = pipeline.get_stats()
        print(json.dumps(stats, indent=2))

if __name__ == "__main__":
    main()
