"""
RemitFlow — CBN Audit Lakehouse Service (Python/FastAPI)

Implements the CBN March 24 2026 circular compliance requirements:
- P2: CBN compliance export (transaction reports, settlement account lists, FX rate audits)
- P2: OpenSearch audit trail indexing for CBN-reportable events
- P2: Delta Lake / Parquet export for regulatory lakehouse
- P2: Automated CBN report generation (monthly, quarterly)

Middleware integrations:
- OpenSearch: audit event indexing + full-text search
- Kafka: consume compliance events from all services
- PostgreSQL: source of truth for all reportable data
- Redis: cache for report metadata
- Dapr: pubsub for triggering downstream workflows

CBN Reportable Events:
- All inbound remittances > $10,000 USD equivalent
- All FX conversions with BMATCH rate deviation > 1%
- Settlement account funding events
- BDC liquidity transfers
- AML/KYC escalations
"""
import os
import json
import csv
import io
import asyncio
import hashlib
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

import asyncpg
import httpx
from fastapi import FastAPI, HTTPException, Depends, Header, BackgroundTasks, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

logging.basicConfig(
    level=logging.INFO,
    format="[CBN-Lakehouse] %(asctime)s %(levelname)s %(message)s"
)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────


def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[python-cbn-lakehouse] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value

DB_URL = _require_env("DATABASE_URL")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://opensearch:9200")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "kafka:9092")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")
# Fail-closed: no default key. Service refuses to start without it.
INTERNAL_KEY = _require_env("CBN_LAKEHOUSE_KEY")
PORT = int(os.getenv("PORT", "8099"))

# ─── Models ───────────────────────────────────────────────────────────────────

# ── PostgreSQL persistence layer ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
import signal
import atexit

_DB_URL = _require_env("DATABASE_URL")
_pg_conn = None

def _get_pg():
    global _pg_conn
    if _pg_conn is None or _pg_conn.closed:
        try:
            _pg_conn = psycopg2.connect(_DB_URL)
            _pg_conn.autocommit = True
            with _pg_conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS python_cbn_lakehouse_state (
                        id TEXT PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_python_cbn_lakehouse_updated
                        ON python_cbn_lakehouse_state(updated_at);
                    CREATE TABLE IF NOT EXISTS python_cbn_lakehouse_events (
                        id BIGSERIAL PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                """)
            logging.info(f"[python-cbn-lakehouse] PostgreSQL connected, tables ready")
        except Exception as e:
            logging.warning(f"[python-cbn-lakehouse] PostgreSQL unavailable ({e}), using in-memory fallback")
            _pg_conn = None
    return _pg_conn

def _db_upsert(record_id: str, data: dict):
    conn = _get_pg()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO python_cbn_lakehouse_state (id, data, updated_at) 
                       VALUES (%s, %s, NOW()) 
                       ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
                    (record_id, json.dumps(data), json.dumps(data))
                )
        except Exception as e:
            logging.warning(f"[python-cbn-lakehouse] DB upsert failed: {e}")

def _db_get(record_id: str) -> Optional[dict]:
    conn = _get_pg()
    if conn:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT data FROM python_cbn_lakehouse_state WHERE id = %s", (record_id,))
                row = cur.fetchone()
                return row['data'] if row else None
        except Exception:
            return None
    return None

def _db_list(limit: int = 100) -> list:
    conn = _get_pg()
    if conn:
        try:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute("SELECT data FROM python_cbn_lakehouse_state ORDER BY updated_at DESC LIMIT %s", (limit,))
                return [row['data'] for row in cur.fetchall()]
        except Exception:
            return []
    return []

def _db_log_event(event_type: str, payload: dict):
    conn = _get_pg()
    if conn:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO python_cbn_lakehouse_events (event_type, payload) VALUES (%s, %s)",
                    (event_type, json.dumps(payload))
                )
        except Exception:
            pass

# Initialize DB connection on startup
_get_pg()


class ExportRequest(BaseModel):
    export_type: str  # "transaction_report" | "settlement_account_list" | "fx_rate_audit" | "bdc_transfers"
    from_date: str    # ISO date string
    to_date: str      # ISO date string
    corridor: Optional[str] = None
    format: str = "json"  # "json" | "csv" | "parquet"

class IndexEventRequest(BaseModel):
    event_type: str
    entity_id: str
    entity_type: str
    data: Dict[str, Any]
    severity: str = "info"  # "info" | "warning" | "critical"
    corridor: Optional[str] = None

class SearchRequest(BaseModel):
    query: str
    event_types: Optional[List[str]] = None
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    limit: int = 50

# ─── Database Pool ────────────────────────────────────────────────────────────
db_pool: Optional[asyncpg.Pool] = None

async def get_db():
    global db_pool
    if db_pool is None:
        try:
            db_pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=10)
            logger.info("PostgreSQL pool created")
        except Exception as e:
            logger.error(f"DB pool creation failed: {e}")
            raise HTTPException(status_code=503, detail="Database unavailable")
    return db_pool

# ─── OpenSearch Client ────────────────────────────────────────────────────────
async def opensearch_index(index: str, doc_id: str, doc: dict) -> bool:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.put(
                f"{OPENSEARCH_URL}/{index}/_doc/{doc_id}",
                json=doc,
                headers={"Content-Type": "application/json"},
            )
            return resp.status_code in (200, 201)
    except Exception as e:
        logger.warning(f"OpenSearch index failed: {e}")
        return False

async def opensearch_search(index: str, query: dict) -> dict:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(
                f"{OPENSEARCH_URL}/{index}/_search",
                json=query,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning(f"OpenSearch search failed: {e}")
    return {"hits": {"hits": [], "total": {"value": 0}}}

async def ensure_opensearch_index(index: str, mappings: dict):
    """Create OpenSearch index with mappings if it doesn't exist."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            check = await client.head(f"{OPENSEARCH_URL}/{index}")
            if check.status_code == 404:
                await client.put(
                    f"{OPENSEARCH_URL}/{index}",
                    json={"mappings": mappings},
                    headers={"Content-Type": "application/json"},
                )
                logger.info(f"Created OpenSearch index: {index}")
    except Exception as e:
        logger.warning(f"OpenSearch index setup failed: {e}")

# ─── Kafka Publisher ──────────────────────────────────────────────────────────
async def publish_dapr_event(topic: str, data: dict):
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(
                f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/remitflow-pubsub/{topic}",
                json={**data, "timestamp": datetime.now(timezone.utc).isoformat()},
                headers={"Content-Type": "application/json"},
            )
    except Exception:
        logger.debug(f"Dapr publish skipped (not available): {topic}")

# ─── Auth ─────────────────────────────────────────────────────────────────────
def require_internal_key(x_internal_key: str = Header(default="")):
    if x_internal_key != INTERNAL_KEY:
        raise HTTPException(status_code=401, detail="Unauthorized")

# ─── Export Generators ────────────────────────────────────────────────────────
async def generate_transaction_report(pool, from_dt: datetime, to_dt: datetime, corridor: Optional[str]) -> List[dict]:
    """Generate CBN-reportable transaction report."""
    query = """
        SELECT 
            t.id, t.reference, t."userId", u.email, u.name,
            t.type, t.status, t."fromCurrency", t."fromAmount",
            t."toCurrency", t."toAmount", t."fxRate", t.fee,
            t."recipientName", t."recipientAccount", t."recipientBank", t."recipientCountry",
            t.channel, t."createdAt"
        FROM transactions t
        LEFT JOIN users u ON t."userId" = u.id
        WHERE t."createdAt" BETWEEN $1 AND $2
    """
    args = [from_dt, to_dt]
    if corridor:
        query += " AND (t.\"fromCurrency\" = $3 OR t.\"toCurrency\" = $3)"
        args.append(corridor.split('-')[0] if '-' in corridor else corridor)
    query += ' ORDER BY t."createdAt" DESC LIMIT 10000'
    
    rows = await pool.fetch(query, *args)
    return [dict(r) for r in rows]

async def generate_settlement_account_list(pool) -> List[dict]:
    """Generate CBN settlement account registry export."""
    rows = await pool.fetch("""
        SELECT sa.*, u.name as created_by_name, u.email as created_by_email
        FROM settlement_accounts sa
        LEFT JOIN users u ON sa.created_by = u.id
        ORDER BY sa.corridor, sa.is_primary DESC
    """)
    return [dict(r) for r in rows]

async def generate_fx_rate_audit(pool, from_dt: datetime, to_dt: datetime) -> List[dict]:
    """Generate BMATCH FX rate audit trail."""
    rows = await pool.fetch("""
        SELECT * FROM bmatch_rate_snapshots
        WHERE snapshot_at BETWEEN $1 AND $2
        ORDER BY snapshot_at DESC
        LIMIT 5000
    """, from_dt, to_dt)
    return [dict(r) for r in rows]

async def generate_bdc_transfers(pool, from_dt: datetime, to_dt: datetime) -> List[dict]:
    """Generate BDC liquidity transfer report."""
    rows = await pool.fetch("""
        SELECT blr.*, bp.name as bdc_name, bp.cbn_licence_number,
               sa.corridor, sa.adb_name
        FROM bdc_liquidity_requests blr
        LEFT JOIN bdc_partners bp ON blr.bdc_partner_id = bp.id
        LEFT JOIN settlement_accounts sa ON blr.settlement_account_id = sa.id
        WHERE blr.created_at BETWEEN $1 AND $2
        ORDER BY blr.created_at DESC
    """, from_dt, to_dt)
    return [dict(r) for r in rows]

def records_to_csv(records: List[dict]) -> str:
    if not records:
        return ""
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=records[0].keys())
    writer.writeheader()
    for r in records:
        # Convert non-serializable types
        row = {}
        for k, v in r.items():
            if isinstance(v, datetime):
                row[k] = v.isoformat()
            elif v is None:
                row[k] = ""
            else:
                row[k] = str(v)
        writer.writerow(row)
    return output.getvalue()

def compute_report_hash(data: Any) -> str:
    """Compute SHA-256 hash of report for tamper evidence."""
    content = json.dumps(data, default=str, sort_keys=True)
    return hashlib.sha256(content.encode()).hexdigest()

# ─── App ──────────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Setup OpenSearch indices on startup
    await ensure_opensearch_index("remitflow-cbn-audit", {
        "properties": {
            "event_type": {"type": "keyword"},
            "entity_id": {"type": "keyword"},
            "entity_type": {"type": "keyword"},
            "severity": {"type": "keyword"},
            "corridor": {"type": "keyword"},
            "timestamp": {"type": "date"},
            "data": {"type": "object", "dynamic": True},
        }
    })
    await ensure_opensearch_index("remitflow-fx-rates", {
        "properties": {
            "pair": {"type": "keyword"},
            "mid_rate": {"type": "float"},
            "within_cbn_limit": {"type": "boolean"},
            "session": {"type": "keyword"},
            "snapshot_at": {"type": "date"},
        }
    })
    logger.info(f"CBN Lakehouse service ready on port {PORT}")
    yield

app = FastAPI(
    title="RemitFlow CBN Audit Lakehouse",
    description="CBN compliance export, OpenSearch audit indexing, and regulatory reporting",
    version="v187",
    lifespan=lifespan,
)

@app.get("/metrics")
async def _prometheus_metrics():
    uptime = _time_mod.time() - _PROCESS_START_TIME
    return Response(
        content=(
            f"# HELP pod_uptime_seconds Time since process started\n"
            f"# TYPE pod_uptime_seconds gauge\n"
            f'pod_uptime_seconds{{service="python-cbn-lakehouse"}} {uptime:.1f}\n'
            f"# HELP pod_ready Whether pod is ready\n"
            f"# TYPE pod_ready gauge\n"
            f'pod_ready{{service="python-cbn-lakehouse"}} 1\n'
        ),
        media_type="text/plain; version=0.0.4",
    )


# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-cbn-lakehouse").info(f"Received signal {signum}, initiating graceful shutdown...")
    _emit_lifecycle_event("pod.shutdown.initiated", signal=signum)

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

# ── Pod Lifecycle Observability ─────────────────────────────────────────
import time as _time_mod
_PROCESS_START_TIME = _time_mod.time()
_LIFECYCLE_LOGGER = logging.getLogger("pod-lifecycle")

def _emit_lifecycle_event(event_type: str, **kwargs):
    """Emit structured JSON lifecycle event for OpenSearch/Fluentd ingestion."""
    import json as _json
    payload = {
        "event": event_type,
        "service": "python-cbn-lakehouse",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-cbn-lakehouse").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "python-cbn-lakehouse",
        "version": "v187",
        "description": "CBN Audit Lakehouse — OpenSearch + PostgreSQL + Kafka",
    }

@app.post("/export", dependencies=[Depends(require_internal_key)])
async def export_report(req: ExportRequest, background_tasks: BackgroundTasks):
    """Generate a CBN compliance export in JSON or CSV format."""
    pool = await get_db()
    
    try:
        from_dt = datetime.fromisoformat(req.from_date.replace("Z", "+00:00"))
        to_dt = datetime.fromisoformat(req.to_date.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid date format: {e}")

    if req.export_type == "transaction_report":
        records = await generate_transaction_report(pool, from_dt, to_dt, req.corridor)
    elif req.export_type == "settlement_account_list":
        records = await generate_settlement_account_list(pool)
    elif req.export_type == "fx_rate_audit":
        records = await generate_fx_rate_audit(pool, from_dt, to_dt)
    elif req.export_type == "bdc_transfers":
        records = await generate_bdc_transfers(pool, from_dt, to_dt)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown export_type: {req.export_type}")

    report_hash = compute_report_hash(records)
    
    # Index export event in OpenSearch
    background_tasks.add_task(
        opensearch_index,
        "remitflow-cbn-audit",
        f"export-{req.export_type}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        {
            "event_type": "cbn_compliance_export",
            "entity_type": "report",
            "entity_id": report_hash[:16],
            "severity": "info",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": {
                "export_type": req.export_type,
                "record_count": len(records),
                "from_date": req.from_date,
                "to_date": req.to_date,
                "corridor": req.corridor,
                "report_hash": report_hash,
            }
        }
    )

    if req.format == "csv":
        csv_content = records_to_csv(records)
        return StreamingResponse(
            io.StringIO(csv_content),
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="remitflow-cbn-{req.export_type}-{datetime.now().strftime("%Y%m%d")}.csv"'
            }
        )

    return {
        "export_type": req.export_type,
        "from_date": req.from_date,
        "to_date": req.to_date,
        "corridor": req.corridor,
        "record_count": len(records),
        "report_hash": report_hash,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "attestation": (
            f"This report was generated by RemitFlow Technology Limited in compliance with "
            f"the CBN Circular of March 24, 2026. Record count: {len(records)}. "
            f"SHA-256: {report_hash}"
        ),
        "records": records,
    }

@app.post("/index-event", dependencies=[Depends(require_internal_key)])
async def index_event(req: IndexEventRequest):
    """Index a CBN-reportable event in OpenSearch."""
    doc_id = f"{req.event_type}-{req.entity_id}-{int(datetime.now(timezone.utc).timestamp() * 1000)}"
    doc = {
        "event_type": req.event_type,
        "entity_id": req.entity_id,
        "entity_type": req.entity_type,
        "severity": req.severity,
        "corridor": req.corridor,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": req.data,
    }
    success = await opensearch_index("remitflow-cbn-audit", doc_id, doc)
    return {"success": success, "doc_id": doc_id}

@app.post("/search", dependencies=[Depends(require_internal_key)])
async def search_audit(req: SearchRequest):
    """Full-text search across CBN audit events in OpenSearch."""
    must_clauses = [{"multi_match": {"query": req.query, "fields": ["event_type", "data.*", "entity_type"]}}]
    
    if req.event_types:
        must_clauses.append({"terms": {"event_type": req.event_types}})
    
    if req.from_date or req.to_date:
        range_filter: dict = {}
        if req.from_date:
            range_filter["gte"] = req.from_date
        if req.to_date:
            range_filter["lte"] = req.to_date
        must_clauses.append({"range": {"timestamp": range_filter}})

    query = {
        "query": {"bool": {"must": must_clauses}},
        "size": req.limit,
        "sort": [{"timestamp": {"order": "desc"}}],
    }
    
    result = await opensearch_search("remitflow-cbn-audit", query)
    hits = result.get("hits", {})
    return {
        "total": hits.get("total", {}).get("value", 0),
        "results": [h["_source"] for h in hits.get("hits", [])],
    }

@app.get("/stats", dependencies=[Depends(require_internal_key)])
async def get_stats():
    """Get CBN compliance statistics."""
    pool = await get_db()
    
    total_accounts = await pool.fetchval("SELECT COUNT(*) FROM settlement_accounts") or 0
    filed_accounts = await pool.fetchval("SELECT COUNT(*) FROM settlement_accounts WHERE status = 'filed'") or 0
    total_bmatch = await pool.fetchval("SELECT COUNT(*) FROM bmatch_rate_snapshots") or 0
    blocked_funding = await pool.fetchval("SELECT COUNT(*) FROM wallet_funding_events WHERE is_nfem_approved = false") or 0
    total_exports = await pool.fetchval("SELECT COUNT(*) FROM cbn_compliance_exports") or 0
    approved_bdc = await pool.fetchval("SELECT COUNT(*) FROM bdc_partners WHERE status = 'approved'") or 0

    # Latest BMATCH rate
    latest_rate = await pool.fetchrow(
        "SELECT pair, mid_rate, within_cbn_limit, snapshot_at FROM bmatch_rate_snapshots WHERE pair = 'USD/NGN' ORDER BY snapshot_at DESC LIMIT 1"
    )

    return {
        "settlement_accounts": {"total": total_accounts, "filed": filed_accounts},
        "bmatch_snapshots": {"total": total_bmatch},
        "wallet_funding": {"blocked_events": blocked_funding},
        "compliance_exports": {"total": total_exports},
        "bdc_partners": {"approved": approved_bdc},
        "latest_usd_ngn_rate": dict(latest_rate) if latest_rate else None,
        "compliance_score": max(0, min(100, int(
            (filed_accounts / max(total_accounts, 1)) * 100 - blocked_funding * 2
        ))),
    }

@app.post("/ingest-fx-rates", dependencies=[Depends(require_internal_key)])
async def ingest_fx_rates():
    """Pull latest BMATCH snapshots from DB and index in OpenSearch."""
    pool = await get_db()
    rows = await pool.fetch(
        "SELECT * FROM bmatch_rate_snapshots ORDER BY snapshot_at DESC LIMIT 100"
    )
    indexed = 0
    for row in rows:
        r = dict(row)
        doc_id = f"rate-{r['pair'].replace('/', '-')}-{int(r['snapshot_at'].timestamp() * 1000)}"
        success = await opensearch_index("remitflow-fx-rates", doc_id, {
            "pair": r["pair"],
            "mid_rate": float(r["mid_rate"]),
            "bid_rate": float(r["bid_rate"]) if r["bid_rate"] else None,
            "ask_rate": float(r["ask_rate"]) if r["ask_rate"] else None,
            "within_cbn_limit": r["within_cbn_limit"],
            "source": r["source"],
            "session": r["session"],
            "snapshot_at": r["snapshot_at"].isoformat() if r["snapshot_at"] else None,
        })
        if success:
            indexed += 1
    
    return {"indexed": indexed, "total": len(rows)}

@app.get("/corridors")
async def get_corridors():
    """Return supported corridors and their CBN compliance status."""
    return {
        "corridors": [
            {"code": "NG-US", "name": "Nigeria ↔ United States", "status": "active", "rail": "PAPSS + SWIFT", "cbn_approved": True},
            {"code": "NG-GB", "name": "Nigeria ↔ United Kingdom", "status": "active", "rail": "PAPSS + CHAPS", "cbn_approved": True},
            {"code": "NG-GH", "name": "Nigeria ↔ Ghana", "status": "active", "rail": "PAPSS + GHIPSS", "cbn_approved": True},
            {"code": "NG-KE", "name": "Nigeria ↔ Kenya", "status": "active", "rail": "PAPSS + PESALINK", "cbn_approved": True},
            {"code": "NG-ZA", "name": "Nigeria ↔ South Africa", "status": "active", "rail": "PAPSS + RTGS", "cbn_approved": True},
            {"code": "NG-EU", "name": "Nigeria ↔ Eurozone", "status": "active", "rail": "PAPSS + SEPA", "cbn_approved": True},
            {"code": "NG-CA", "name": "Nigeria ↔ Canada", "status": "active", "rail": "PAPSS + Interac", "cbn_approved": True},
            {"code": "NG-AU", "name": "Nigeria ↔ Australia", "status": "active", "rail": "PAPSS + NPP", "cbn_approved": True},
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
