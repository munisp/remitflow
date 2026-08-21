"""
RemitFlow — Data Lakehouse Service (Python/FastAPI + DuckDB + Apache Iceberg)
Analytical data warehouse for RemitFlow business intelligence.

Architecture:
- Storage: S3-compatible object store (MinIO/S3)
- Table Format: Apache Iceberg (ACID, time-travel, schema evolution)
- Query Engine: DuckDB (in-process OLAP, columnar)
- Orchestration: Temporal workflows trigger ETL jobs
- Serving: FastAPI REST API for BI queries

Tables:
- transactions (partitioned by date, currency)
- users (SCD Type 2 — slowly changing dimensions)
- fx_rates (time series)
- compliance_events
- partner_earnings

Use Cases:
- Monthly revenue reports
- Corridor analysis
- Regulatory reporting (FinCEN, FINCEN, RBI)
- Partner commission calculations
- Fraud pattern analysis
"""

import os
import json
import logging
import re
import secrets
from datetime import datetime, timezone, timedelta, date
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Depends, Header, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import duckdb

# ─── Configuration ────────────────────────────────────────────────────────────
def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known defaults."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[lakehouse-service] {name} is not set. Refusing to start with a "
            "well-known default credential; configure it explicitly."
        )
    return value

LAKEHOUSE_PATH = os.getenv("LAKEHOUSE_PATH", "/data/remitflow-lakehouse")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "http://minio:9000")
S3_BUCKET = os.getenv("S3_BUCKET", "remitflow-lakehouse")
# Fail-closed: no default key baked into the image (PY-002 remediation).
INTERNAL_API_KEY = _require_env("LAKEHOUSE_INTERNAL_API_KEY")
DATABASE_URL = _require_env("DATABASE_URL")

logging.basicConfig(level=logging.INFO, format="[Lakehouse] %(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

os.makedirs(LAKEHOUSE_PATH, exist_ok=True)

# ─── DuckDB Setup ─────────────────────────────────────────────────────────────
def get_db() -> duckdb.DuckDBPyConnection:
    db_path = os.path.join(LAKEHOUSE_PATH, "remitflow.duckdb")
    conn = duckdb.connect(db_path)
    return conn

def init_lakehouse():
    """Initialize DuckDB tables (Iceberg-compatible schema)"""
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            transaction_id VARCHAR PRIMARY KEY,
            user_id BIGINT,
            rail VARCHAR,
            from_currency VARCHAR,
            to_currency VARCHAR,
            amount DOUBLE,
            fee_amount DOUBLE,
            exchange_rate DOUBLE,
            status VARCHAR,
            recipient_name VARCHAR,
            recipient_country VARCHAR,
            external_ref VARCHAR,
            created_at TIMESTAMP,
            settled_at TIMESTAMP,
            partition_date DATE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users_dim (
            user_id BIGINT,
            email VARCHAR,
            full_name VARCHAR,
            country VARCHAR,
            kyc_tier INTEGER,
            kyc_status VARCHAR,
            risk_level VARCHAR,
            total_sent DOUBLE,
            total_received DOUBLE,
            is_current BOOLEAN,
            valid_from TIMESTAMP,
            valid_to TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fx_rates_ts (
            id VARCHAR,
            from_currency VARCHAR,
            to_currency VARCHAR,
            rate DOUBLE,
            bid DOUBLE,
            ask DOUBLE,
            spread DOUBLE,
            source VARCHAR,
            recorded_at TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS compliance_events (
            event_id VARCHAR PRIMARY KEY,
            transaction_id VARCHAR,
            user_id BIGINT,
            event_type VARCHAR,
            risk_score DOUBLE,
            risk_level VARCHAR,
            flags VARCHAR[],
            resolved BOOLEAN,
            created_at TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS partner_earnings (
            id VARCHAR PRIMARY KEY,
            partner_id BIGINT,
            month VARCHAR,
            transaction_count BIGINT,
            total_volume DOUBLE,
            commission_rate DOUBLE,
            earnings_amount DOUBLE,
            currency VARCHAR,
            status VARCHAR,
            paid_at TIMESTAMP,
            created_at TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS fx_rate_snapshots (
            snapshot_id VARCHAR,
            from_currency VARCHAR,
            to_currency VARCHAR,
            rate DOUBLE,
            snapshot_date DATE,
            source VARCHAR
        )
    """)
    conn.close()
    logger.info("Lakehouse tables initialized")

# ─── Models ───────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    sql: str
    params: Optional[List[Any]] = None
    limit: int = 1000

class IngestTransactionRequest(BaseModel):
    transaction_id: str
    user_id: int
    rail: str
    from_currency: str
    to_currency: str
    amount: float
    fee_amount: float = 0.0
    exchange_rate: float = 1.0
    status: str
    recipient_name: Optional[str] = None
    recipient_country: Optional[str] = None
    external_ref: Optional[str] = None
    created_at: Optional[str] = None
    settled_at: Optional[str] = None

class ReportRequest(BaseModel):
    report_type: str  # monthly_revenue, corridor_analysis, regulatory_sar, partner_commission
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None

# ─── API Key Auth ──────────────────────────────────────────────────────────────
def verify_api_key(x_api_key: str = Header(None)):
    # Constant-time comparison; INTERNAL_API_KEY is guaranteed set at import time.
    if not x_api_key or not secrets.compare_digest(x_api_key, INTERNAL_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid API key")


# ─── Analytical SQL guard (PY-001/PY-002 remediation) ─────────────────────────
# DuckDB features that enable file/network reads, schema mutation, extension
# loading, or writes. Blocked regardless of the SELECT-prefix check.
_FORBIDDEN_SQL = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|read_text|read_blob|"
    r"glob|parquet_scan|csv_scan|json_scan|sqlite_scan|postgres_scan|mysql_scan|"
    r"httpfs|attach|detach|copy|install|load|force_install|pragma|set|reset|"
    r"export|import|create|drop|alter|insert|update|delete|truncate|grant|revoke|"
    r"call|checkpoint|vacuum|analyze|use|begin|commit|rollback|transaction|"
    r"prepare|execute\s+immediate)\b",
    re.IGNORECASE,
)

_TABLE_REF = re.compile(r"\b(?:from|join)\s+([A-Za-z_][A-Za-z0-9_.]*)", re.IGNORECASE)
_CTE_NAME = re.compile(r"\bwith\s+([A-Za-z_][A-Za-z0-9_]*)\s+as\b|,\s*([A-Za-z_][A-Za-z0-9_]*)\s+as\s*\(", re.IGNORECASE)

# Base tables created by init_lakehouse(); anything else is rejected.
_ALLOWED_TABLES = {"transactions", "users_dim", "fx_rates_ts", "compliance_events", "partner_earnings"}


def _validate_analytical_sql(sql: str) -> None:
    """Allow only a single read-only SELECT/WITH over the known lakehouse tables."""
    stripped = sql.strip()
    if not stripped:
        raise HTTPException(status_code=400, detail="Empty SQL")
    if ";" in stripped or "--" in stripped or "/*" in stripped:
        raise HTTPException(status_code=400, detail="Statement chaining and SQL comments are not allowed")
    upper = stripped.upper()
    if not (upper.startswith("SELECT") or upper.startswith("WITH")):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")
    m = _FORBIDDEN_SQL.search(stripped)
    if m:
        raise HTTPException(status_code=400, detail=f"Forbidden SQL construct: {m.group(0).strip()}")
    ctes = {n.lower() for tup in _CTE_NAME.findall(stripped) for n in tup if n}
    for target in _TABLE_REF.findall(stripped):
        t = target.lower()
        if t in ctes:
            continue
        if t not in _ALLOWED_TABLES:
            raise HTTPException(
                status_code=400,
                detail=f"Table '{target}' is not an allowed lakehouse table",
            )

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow Data Lakehouse",
    description="OLAP analytics and regulatory reporting for RemitFlow",
    version="v110.0.0",
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    init_lakehouse()
    await _sync_from_postgres()

async def _sync_from_postgres():
    """Sync data from PostgreSQL OLTP into DuckDB for OLAP analytics."""
    try:
        import asyncpg
        pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3, command_timeout=30)
    except Exception as e:
        logger.warning(f"PostgreSQL not available: {e} — using demo data")
        _seed_demo_data()
        return

    conn = get_db()
    try:
        async with pool.acquire() as pg:
            # Sync transactions
            rows = await pg.fetch("""
                SELECT id::text, user_id, amount::float8, currency as from_currency,
                       to_currency, fee::float8, exchange_rate::float8, status,
                       reference as external_ref, destination_country as recipient_country,
                       created_at
                FROM transactions
                ORDER BY created_at DESC
                LIMIT 50000
            """)
            if rows:
                conn.execute("DELETE FROM transactions")
                for r in rows:
                    rail = "swift"
                    created = r["created_at"] or datetime.now(timezone.utc)
                    settled = created + timedelta(minutes=5)
                    conn.execute("""
                        INSERT OR REPLACE INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, [
                        r["id"], r["user_id"], rail, r["from_currency"] or "USD",
                        r["to_currency"] or "USD", float(r["amount"] or 0),
                        float(r["fee"] or 0), float(r["exchange_rate"] or 1.0),
                        r["status"] or "PENDING", None, r["recipient_country"],
                        r["external_ref"], created, settled,
                        created.date() if hasattr(created, "date") else None,
                    ])
                logger.info(f"Synced {len(rows)} transactions from PostgreSQL")
            else:
                logger.info("No transactions in PostgreSQL — using demo data")
                conn.close()
                _seed_demo_data()
                return

            # Sync FX rates
            fx_rows = await pg.fetch("""
                SELECT id::text, "fromCurrency" as from_currency, "toCurrency" as to_currency,
                       rates::text, "updatedAt" as recorded_at
                FROM "fxRateCache"
                ORDER BY "updatedAt" DESC
                LIMIT 10000
            """)
            if fx_rows:
                for r in fx_rows:
                    try:
                        rates = json.loads(r["rates"]) if r["rates"] else {}
                        to_c = r["to_currency"] or "USD"
                        rate = rates.get(to_c, 1.0) if isinstance(rates, dict) else 1.0
                        conn.execute("""
                            INSERT OR REPLACE INTO fx_rates_ts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, [
                            r["id"], r["from_currency"], to_c,
                            float(rate), float(rate) * 0.999, float(rate) * 1.001,
                            0.002, "postgres", r["recorded_at"],
                        ])
                    except Exception:
                        continue
                logger.info(f"Synced {len(fx_rows)} FX rate entries from PostgreSQL")

    except Exception as e:
        logger.warning(f"PostgreSQL sync error: {e} — using demo data")
        conn.close()
        _seed_demo_data()
        return
    finally:
        conn.close()
        await pool.close()


def _seed_demo_data():
    """Seed demo transactions for analytics when PostgreSQL is unavailable."""
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    if count > 0:
        conn.close()
        return

    import random
    rails = ["mojaloop", "cips", "upi", "pix", "swift", "sepa"]
    currencies = [("USD", "CNY"), ("USD", "INR"), ("USD", "BRL"), ("EUR", "NGN"), ("GBP", "KES"), ("USD", "NGN")]
    statuses = ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "PENDING", "FAILED"]

    for i in range(2000):
        from_c, to_c = random.choice(currencies)
        rail = random.choice(rails)
        amount = round(random.uniform(50, 15000), 2)
        fee = round(amount * random.uniform(0.002, 0.01), 2)
        days_ago = random.randint(0, 365)
        created = datetime.now(timezone.utc) - timedelta(days=days_ago)
        conn.execute("""
            INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            f"TXN{i:06d}", random.randint(1, 200), rail, from_c, to_c,
            amount, fee, random.uniform(0.8, 1650.0), random.choice(statuses),
            f"Recipient {i}", random.choice(["CN", "IN", "BR", "NG", "KE", "GH", "ZA", "US", "GB"]),
            f"EXT{i:08d}", created, created + timedelta(minutes=random.randint(1, 120)),
            created.date()
        ])

    conn.close()
    logger.info("Seeded 2000 demo transactions")

@app.get("/health")
async def health():
    conn = get_db()
    tx_count = conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
    conn.close()
    return {
        "status": "healthy",
        "service": "lakehouse",
        "version": "v110.0.0",
        "transaction_count": tx_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/api/v1/ingest/transaction")
async def ingest_transaction(req: IngestTransactionRequest, _=Depends(verify_api_key)):
    """Ingest a transaction into the lakehouse"""
    conn = get_db()
    created = req.created_at or datetime.now(timezone.utc).isoformat()
    conn.execute("""
        INSERT OR REPLACE INTO transactions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        req.transaction_id, req.user_id, req.rail, req.from_currency, req.to_currency,
        req.amount, req.fee_amount, req.exchange_rate, req.status,
        req.recipient_name, req.recipient_country, req.external_ref,
        created, req.settled_at, datetime.now(timezone.utc).date()
    ])
    conn.close()
    return {"ingested": True, "transaction_id": req.transaction_id}

@app.post("/api/v1/query")
async def run_query(req: QueryRequest, _=Depends(verify_api_key)):
    """Execute an analytical SQL query against the lakehouse"""
    # Security: single-statement read-only SELECT/WITH over allowlisted tables;
    # DuckDB file/network functions, DDL/DML and extension loading are blocked.
    _validate_analytical_sql(req.sql)

    conn = get_db()
    try:
        result = conn.execute(req.sql).fetchdf()
        return {
            "rows": result.head(req.limit).to_dict(orient="records"),
            "total_rows": len(result),
            "columns": list(result.columns),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        conn.close()

@app.get("/api/v1/reports/monthly-revenue")
async def monthly_revenue_report(
    year: int = Query(default=datetime.now().year),
    month: int = Query(default=datetime.now().month),
    _=Depends(verify_api_key),
):
    """Generate monthly revenue report"""
    conn = get_db()
    result = conn.execute("""
        SELECT
            rail,
            from_currency,
            to_currency,
            COUNT(*) as transaction_count,
            SUM(amount) as total_volume,
            SUM(fee_amount) as total_fees,
            AVG(amount) as avg_amount,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed_count,
            COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed_count
        FROM transactions
        WHERE YEAR(created_at) = ? AND MONTH(created_at) = ?
        GROUP BY rail, from_currency, to_currency
        ORDER BY total_volume DESC
    """, [year, month]).fetchdf()
    conn.close()

    return {
        "report_type": "monthly_revenue",
        "year": year,
        "month": month,
        "data": result.to_dict(orient="records"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/api/v1/reports/corridor-analysis")
async def corridor_analysis(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    top_n: int = Query(default=10),
    _=Depends(verify_api_key),
):
    """Analyze top remittance corridors"""
    date_from = date_from or (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
    date_to = date_to or datetime.now(timezone.utc).isoformat()

    conn = get_db()
    result = conn.execute("""
        SELECT
            from_currency || '->' || to_currency as corridor,
            rail,
            COUNT(*) as transaction_count,
            SUM(amount) as total_volume,
            AVG(amount) as avg_amount,
            AVG(exchange_rate) as avg_rate,
            SUM(fee_amount) as total_fees
        FROM transactions
        WHERE created_at BETWEEN ? AND ?
          AND status = 'COMPLETED'
        GROUP BY corridor, rail
        ORDER BY total_volume DESC
        LIMIT ?
    """, [date_from, date_to, top_n]).fetchdf()
    conn.close()

    return {
        "report_type": "corridor_analysis",
        "date_from": date_from,
        "date_to": date_to,
        "corridors": result.to_dict(orient="records"),
    }

@app.get("/api/v1/reports/regulatory")
async def regulatory_report(
    report_type: str = Query(default="ctr"),  # ctr (>$10k), sar, fincen
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    _=Depends(verify_api_key),
):
    """Generate regulatory compliance reports (CTR, SAR)"""
    date_from = date_from or (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    date_to = date_to or datetime.now(timezone.utc).isoformat()

    conn = get_db()

    if report_type == "ctr":
        # Currency Transaction Report: transactions > $10,000
        result = conn.execute("""
            SELECT transaction_id, user_id, amount, from_currency, to_currency,
                   rail, recipient_country, created_at
            FROM transactions
            WHERE amount > 10000 AND created_at BETWEEN ? AND ?
            ORDER BY amount DESC
        """, [date_from, date_to]).fetchdf()
    elif report_type == "sar":
        # Suspicious Activity Report: structuring patterns
        result = conn.execute("""
            SELECT user_id, COUNT(*) as tx_count, SUM(amount) as total,
                   MIN(amount) as min_amount, MAX(amount) as max_amount
            FROM transactions
            WHERE created_at BETWEEN ? AND ?
            GROUP BY user_id
            HAVING tx_count > 10 AND total > 9000 AND max_amount < 10000
            ORDER BY total DESC
        """, [date_from, date_to]).fetchdf()
    else:
        result = conn.execute("""
            SELECT * FROM transactions WHERE created_at BETWEEN ? AND ? LIMIT 100
        """, [date_from, date_to]).fetchdf()

    conn.close()
    return {
        "report_type": report_type,
        "date_from": date_from,
        "date_to": date_to,
        "record_count": len(result),
        "data": result.to_dict(orient="records"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/api/v1/stats/overview")
async def overview_stats(_=Depends(verify_api_key)):
    """Get high-level platform statistics"""
    conn = get_db()
    stats = conn.execute("""
        SELECT
            COUNT(*) as total_transactions,
            COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END) as completed,
            COUNT(CASE WHEN status = 'FAILED' THEN 1 END) as failed,
            SUM(CASE WHEN status = 'COMPLETED' THEN amount ELSE 0 END) as total_volume,
            SUM(CASE WHEN status = 'COMPLETED' THEN fee_amount ELSE 0 END) as total_fees,
            AVG(CASE WHEN status = 'COMPLETED' THEN amount END) as avg_amount,
            COUNT(DISTINCT user_id) as unique_users,
            COUNT(DISTINCT from_currency || to_currency) as active_corridors
        FROM transactions
    """).fetchone()
    conn.close()

    return {
        "total_transactions": stats[0],
        "completed": stats[1],
        "failed": stats[2],
        "total_volume_usd": round(stats[3] or 0, 2),
        "total_fees_usd": round(stats[4] or 0, 2),
        "avg_amount_usd": round(stats[5] or 0, 2),
        "unique_users": stats[6],
        "active_corridors": stats[7],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8101"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
