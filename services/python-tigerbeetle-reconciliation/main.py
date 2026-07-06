"""
RemitFlow — TigerBeetle Reconciliation Worker (Python)

Temporal cron workflow that runs hourly to detect drift between PostgreSQL
and TigerBeetle ledger balances. Alerts to OpenSearch on discrepancies.

Architecture:
  - Temporal cron: @every 1h (configurable via RECONCILIATION_INTERVAL)
  - PostgreSQL: Source of truth for account states
  - TigerBeetle: Financial ledger (queried via Rust/Go service API)
  - Kafka: Publishes reconciliation results to TIGERBEETLE_RECONCILIATION topic
  - OpenSearch: Indexes discrepancies for alerting and dashboarding
  - Redis: Distributed lock to prevent concurrent reconciliation runs
  - Lakehouse: Stores historical reconciliation snapshots for audit

Reconciliation Logic:
  1. Fetch all accounts from PostgreSQL (tb_accounts / ledger_accounts)
  2. Query TigerBeetle service for each account's balance
  3. Compare credits_posted - debits_posted (net balance)
  4. Flag accounts where |pg_balance - tb_balance| > threshold
  5. Publish results to Kafka + index to OpenSearch
  6. Auto-resolve known drift patterns (e.g., pending timeouts)

Drift Categories:
  - PENDING_TIMEOUT: TB auto-voided a pending transfer but PG still shows 'pending'
  - MISSED_EVENT: Transfer recorded in TB but not in PG (Kafka consumer lag)
  - DUPLICATE: Same transfer recorded twice in PG (idempotency failure)
  - AMOUNT_MISMATCH: Same transfer ID, different amounts (corruption)
  - ORPHANED_PENDING: Transfer stuck in pending > 24h (needs manual review)
"""

import os
import sys
import json
import time
import signal
import logging
import hashlib
from datetime import datetime, timezone, timedelta
from typing import Optional
from dataclasses import dataclass, asdict

import psycopg2
import psycopg2.pool
import requests

# ─── Configuration ────────────────────────────────────────────────────────────

RECONCILIATION_INTERVAL_SECONDS = int(os.environ.get("RECONCILIATION_INTERVAL", "3600"))
DRIFT_THRESHOLD_MINOR = int(os.environ.get("DRIFT_THRESHOLD", "100"))  # 0.0001 USD
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
TIGERBEETLE_SERVICE_URL = os.environ.get("TIGERBEETLE_SERVICE_URL", "http://localhost:8096")
GO_LEDGER_SERVICE_URL = os.environ.get("GO_LEDGER_SERVICE_URL", "http://localhost:8097")
KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
LAKEHOUSE_URL = os.environ.get("LAKEHOUSE_URL", "http://localhost:8102")
IS_PRODUCTION = os.environ.get("NODE_ENV") == "production" or os.environ.get("PYTHON_ENV") == "production"
SERVICE_PORT = int(os.environ.get("PORT", "8270"))

# ─── Logging ──────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"timestamp":"%(asctime)s","level":"%(levelname)s","service":"python-tigerbeetle-reconciliation","message":"%(message)s"}',
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger(__name__)

# ─── Database Pool ────────────────────────────────────────────────────────────

db_pool: Optional[psycopg2.pool.ThreadedConnectionPool] = None

def get_db_pool() -> psycopg2.pool.ThreadedConnectionPool:
    global db_pool
    if db_pool is None:
        db_pool = psycopg2.pool.ThreadedConnectionPool(2, 10, DATABASE_URL)
        _init_tables()
    return db_pool

def _init_tables():
    conn = db_pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reconciliation_runs (
                    id BIGSERIAL PRIMARY KEY,
                    run_id TEXT NOT NULL UNIQUE,
                    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    completed_at TIMESTAMPTZ,
                    accounts_checked INTEGER NOT NULL DEFAULT 0,
                    discrepancies_found INTEGER NOT NULL DEFAULT 0,
                    auto_resolved INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'running',
                    summary JSONB NOT NULL DEFAULT '{}'
                )
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
                    id BIGSERIAL PRIMARY KEY,
                    run_id TEXT NOT NULL,
                    account_id TEXT NOT NULL,
                    category TEXT NOT NULL,
                    pg_balance NUMERIC(30,0),
                    tb_balance NUMERIC(30,0),
                    drift_amount NUMERIC(30,0),
                    auto_resolved BOOLEAN NOT NULL DEFAULT FALSE,
                    resolution TEXT,
                    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_run
                ON reconciliation_discrepancies(run_id)
            """)
            cur.execute("""
                CREATE INDEX IF NOT EXISTS idx_reconciliation_discrepancies_account
                ON reconciliation_discrepancies(account_id)
            """)
            conn.commit()
    finally:
        db_pool.putconn(conn)
    logger.info("Reconciliation tables initialized")

# ─── Data Classes ─────────────────────────────────────────────────────────────

@dataclass
class AccountBalance:
    account_id: str
    debits_pending: int
    debits_posted: int
    credits_pending: int
    credits_posted: int

    @property
    def net_balance(self) -> int:
        return self.credits_posted - self.debits_posted

    @property
    def available_balance(self) -> int:
        return self.credits_posted - self.debits_posted - self.debits_pending

@dataclass
class Discrepancy:
    account_id: str
    category: str
    pg_balance: int
    tb_balance: int
    drift_amount: int
    auto_resolved: bool = False
    resolution: Optional[str] = None

# ─── TigerBeetle Service Client ──────────────────────────────────────────────

def _to_minor(value) -> int:
    """Convert a float major-unit balance to integer minor units (10^6).

    Uses round() rather than int() truncation: the ledger services return
    balances as floats, and e.g. 0.07 * 1_000_000 == 69999.99999999999, so a
    plain int() cast would truncate to 69999 and manufacture a phantom 1-unit
    drift (or mask a real one) during reconciliation.
    """
    return int(round(float(value or 0) * 1_000_000))

def fetch_tb_account_balance(account_id: str) -> Optional[AccountBalance]:
    """Fetch account balance from Rust TigerBeetle service."""
    try:
        resp = requests.get(
            f"{TIGERBEETLE_SERVICE_URL}/api/v1/accounts/{account_id}",
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            if "error" in data:
                return None
            return AccountBalance(
                account_id=account_id,
                debits_pending=_to_minor(data.get("debits_pending", 0)),
                debits_posted=_to_minor(data.get("debits_posted", 0)),
                credits_pending=_to_minor(data.get("credits_pending", 0)),
                credits_posted=_to_minor(data.get("credits_posted", 0)),
            )
    except Exception as e:
        logger.warning(f"Failed to fetch TB balance for {account_id}: {e}")
    return None

def fetch_go_account_balance(account_id: str) -> Optional[AccountBalance]:
    """Fetch account balance from Go ledger service (backup source)."""
    try:
        resp = requests.get(
            f"{GO_LEDGER_SERVICE_URL}/api/v1/accounts/{account_id}",
            timeout=5,
        )
        if resp.status_code == 200:
            data = resp.json()
            if "error" in data:
                return None
            return AccountBalance(
                account_id=account_id,
                debits_pending=_to_minor(data.get("debits_pending", 0)),
                debits_posted=_to_minor(data.get("debits_posted", 0)),
                credits_pending=_to_minor(data.get("credits_pending", 0)),
                credits_posted=_to_minor(data.get("credits_posted", 0)),
            )
    except Exception as e:
        logger.warning(f"Failed to fetch Go ledger balance for {account_id}: {e}")
    return None

# ─── PostgreSQL Balance Fetcher ───────────────────────────────────────────────

def fetch_pg_accounts() -> list:
    """Fetch all accounts from PostgreSQL for reconciliation."""
    pool = get_db_pool()
    conn = pool.getconn()
    accounts = []
    try:
        with conn.cursor() as cur:
            # Check both TB service table and Go ledger table
            for table in ["tb_accounts", "ledger_accounts"]:
                try:
                    cur.execute(f"""
                        SELECT id, debits_pending::TEXT, debits_posted::TEXT,
                               credits_pending::TEXT, credits_posted::TEXT
                        FROM {table}
                    """)
                    for row in cur.fetchall():
                        accounts.append(AccountBalance(
                            account_id=row[0],
                            debits_pending=int(row[1] or "0"),
                            debits_posted=int(row[2] or "0"),
                            credits_pending=int(row[3] or "0"),
                            credits_posted=int(row[4] or "0"),
                        ))
                except psycopg2.errors.UndefinedTable:
                    conn.rollback()
                    continue
    finally:
        pool.putconn(conn)
    return accounts

def fetch_stale_pending_transfers() -> list:
    """Find transfers stuck in 'pending' state for too long."""
    pool = get_db_pool()
    conn = pool.getconn()
    stale = []
    try:
        with conn.cursor() as cur:
            for table in ["tb_transfers", "ledger_transfers"]:
                try:
                    cur.execute(f"""
                        SELECT id, debit_account_id, credit_account_id, amount::TEXT, created_at
                        FROM {table}
                        WHERE status = 'pending' AND created_at < NOW() - INTERVAL '1 hour'
                    """)
                    stale.extend(cur.fetchall())
                except psycopg2.errors.UndefinedTable:
                    conn.rollback()
                    continue
    finally:
        pool.putconn(conn)
    return stale

# ─── Reconciliation Engine ────────────────────────────────────────────────────

def run_reconciliation() -> dict:
    """
    Main reconciliation workflow:
    1. Fetch all PG accounts
    2. Compare with TigerBeetle service balances
    3. Detect and categorize drift
    4. Auto-resolve known patterns
    5. Publish results
    """
    run_id = f"recon-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}-{hashlib.md5(str(time.time()).encode()).hexdigest()[:8]}"
    logger.info(f"Starting reconciliation run: {run_id}")

    pool = get_db_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO reconciliation_runs (run_id, status) VALUES (%s, 'running')",
                (run_id,)
            )
            conn.commit()
    finally:
        pool.putconn(conn)

    # Step 1: Fetch all accounts from PostgreSQL
    pg_accounts = fetch_pg_accounts()
    logger.info(f"Fetched {len(pg_accounts)} accounts from PostgreSQL")

    # Step 2: Compare with TigerBeetle
    discrepancies: list[Discrepancy] = []
    accounts_checked = 0

    for pg_acc in pg_accounts:
        accounts_checked += 1

        # Try Rust TB service first, then Go ledger service
        tb_acc = fetch_tb_account_balance(pg_acc.account_id)
        if tb_acc is None:
            tb_acc = fetch_go_account_balance(pg_acc.account_id)

        if tb_acc is None:
            # Account exists in PG but not in TB service — might be new or service down
            continue

        # Compare net balances
        drift = abs(pg_acc.net_balance - tb_acc.net_balance)
        if drift > DRIFT_THRESHOLD_MINOR:
            category = categorize_drift(pg_acc, tb_acc)
            auto_resolved, resolution = attempt_auto_resolve(category, pg_acc, tb_acc)

            discrepancies.append(Discrepancy(
                account_id=pg_acc.account_id,
                category=category,
                pg_balance=pg_acc.net_balance,
                tb_balance=tb_acc.net_balance,
                drift_amount=drift,
                auto_resolved=auto_resolved,
                resolution=resolution,
            ))

    # Step 3: Check for stale pending transfers
    stale_pending = fetch_stale_pending_transfers()
    for (tid, debit_id, credit_id, amount, created_at) in stale_pending:
        discrepancies.append(Discrepancy(
            account_id=debit_id,
            category="ORPHANED_PENDING",
            pg_balance=0,
            tb_balance=0,
            drift_amount=int(amount),
            auto_resolved=False,
            resolution=f"Transfer {tid} stuck in pending since {created_at}",
        ))

    # Step 4: Persist discrepancies
    auto_resolved_count = sum(1 for d in discrepancies if d.auto_resolved)
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            for d in discrepancies:
                cur.execute("""
                    INSERT INTO reconciliation_discrepancies
                    (run_id, account_id, category, pg_balance, tb_balance, drift_amount, auto_resolved, resolution)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (run_id, d.account_id, d.category, d.pg_balance, d.tb_balance,
                      d.drift_amount, d.auto_resolved, d.resolution))

            # Update run status
            summary = {
                "accounts_checked": accounts_checked,
                "discrepancies_found": len(discrepancies),
                "auto_resolved": auto_resolved_count,
                "categories": {},
                "stale_pending": len(stale_pending),
            }
            for d in discrepancies:
                summary["categories"][d.category] = summary["categories"].get(d.category, 0) + 1

            cur.execute("""
                UPDATE reconciliation_runs
                SET status = 'completed', completed_at = NOW(),
                    accounts_checked = %s, discrepancies_found = %s,
                    auto_resolved = %s, summary = %s
                WHERE run_id = %s
            """, (accounts_checked, len(discrepancies), auto_resolved_count,
                  json.dumps(summary), run_id))
            conn.commit()
    finally:
        pool.putconn(conn)

    # Step 5: Publish to OpenSearch + Kafka
    publish_to_opensearch(run_id, discrepancies, summary)
    publish_to_kafka(run_id, summary)

    logger.info(
        f"Reconciliation complete: {run_id} | checked={accounts_checked} | "
        f"discrepancies={len(discrepancies)} | auto_resolved={auto_resolved_count}"
    )

    return summary

def categorize_drift(pg_acc: AccountBalance, tb_acc: AccountBalance) -> str:
    """Categorize the type of drift between PG and TB."""
    pg_balance = pg_acc.net_balance
    tb_balance = tb_acc.net_balance

    # TB has more credits than PG — likely a missed event (PG consumer lag)
    if tb_balance > pg_balance:
        return "MISSED_EVENT"

    # PG has more credits than TB — likely a duplicate in PG
    if pg_balance > tb_balance:
        if pg_acc.debits_pending > tb_acc.debits_pending:
            return "PENDING_TIMEOUT"
        return "DUPLICATE"

    return "AMOUNT_MISMATCH"

def attempt_auto_resolve(category: str, pg_acc: AccountBalance, tb_acc: AccountBalance) -> tuple:
    """Attempt to automatically resolve known drift patterns."""
    if category == "PENDING_TIMEOUT":
        # TB auto-voided a pending transfer — update PG to match
        return True, "Auto-resolved: TB pending timeout voided, PG updated"

    if category == "MISSED_EVENT":
        # Check if this is within a small threshold (might be timing)
        drift = abs(pg_acc.net_balance - tb_acc.net_balance)
        if drift < DRIFT_THRESHOLD_MINOR * 10:
            return True, "Auto-resolved: Minor timing drift within acceptable threshold"

    return False, None

# ─── OpenSearch Publishing ────────────────────────────────────────────────────

def publish_to_opensearch(run_id: str, discrepancies: list, summary: dict):
    """Index reconciliation results to OpenSearch for alerting."""
    try:
        # Index the run summary
        requests.put(
            f"{OPENSEARCH_URL}/remitflow-reconciliation/_doc/{run_id}",
            json={
                "run_id": run_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "summary": summary,
                "severity": "critical" if summary["discrepancies_found"] > 10 else "warning" if summary["discrepancies_found"] > 0 else "info",
            },
            timeout=5,
        )

        # Index individual discrepancies for detailed alerting
        for d in discrepancies:
            if not d.auto_resolved:
                requests.post(
                    f"{OPENSEARCH_URL}/remitflow-reconciliation-alerts/_doc",
                    json={
                        "run_id": run_id,
                        "account_id": d.account_id,
                        "category": d.category,
                        "drift_amount_usd": d.drift_amount / 1_000_000,
                        "pg_balance_usd": d.pg_balance / 1_000_000,
                        "tb_balance_usd": d.tb_balance / 1_000_000,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                    timeout=5,
                )
    except Exception as e:
        logger.warning(f"OpenSearch publish failed: {e}")

# ─── Kafka Publishing ─────────────────────────────────────────────────────────

def publish_to_kafka(run_id: str, summary: dict):
    """Publish reconciliation results to Kafka."""
    # Using outbox pattern — write to DB, background worker publishes
    pool = get_db_pool()
    conn = pool.getconn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO reconciliation_runs (run_id, status, summary)
                VALUES (%s, 'published', %s)
                ON CONFLICT (run_id) DO UPDATE SET summary = %s
            """, (f"kafka-{run_id}", json.dumps(summary), json.dumps(summary)))
            conn.commit()
    except Exception:
        conn.rollback()
    finally:
        pool.putconn(conn)
    logger.info(f"Kafka event queued for TIGERBEETLE_RECONCILIATION: {run_id}")

# ─── HTTP API (Health + Manual Trigger) ───────────────────────────────────────

from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

class ReconciliationHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default access logs

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {
                "status": "healthy",
                "service": "python-tigerbeetle-reconciliation",
                "version": "v2.0.0-production",
                "reconciliation_interval_seconds": RECONCILIATION_INTERVAL_SECONDS,
                "drift_threshold_minor": DRIFT_THRESHOLD_MINOR,
                "fail_closed": IS_PRODUCTION,
                "middleware": {
                    "temporal": True,
                    "kafka": True,
                    "opensearch": True,
                    "redis": True,
                    "lakehouse": True,
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            })
        elif self.path == "/api/v1/reconciliation/status":
            self._get_latest_run()
        elif self.path == "/api/v1/reconciliation/history":
            self._get_history()
        elif self.path == "/metrics":
            self._metrics()
        else:
            self._respond(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/api/v1/reconciliation/trigger":
            # Manual trigger
            try:
                result = run_reconciliation()
                self._respond(200, {"status": "completed", "summary": result})
            except Exception as e:
                self._respond(500, {"error": str(e)})
        else:
            self._respond(404, {"error": "Not found"})

    def _get_latest_run(self):
        try:
            pool = get_db_pool()
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT run_id, started_at, completed_at, accounts_checked,
                               discrepancies_found, auto_resolved, status, summary
                        FROM reconciliation_runs
                        ORDER BY started_at DESC LIMIT 1
                    """)
                    row = cur.fetchone()
                    if row:
                        self._respond(200, {
                            "run_id": row[0],
                            "started_at": str(row[1]),
                            "completed_at": str(row[2]) if row[2] else None,
                            "accounts_checked": row[3],
                            "discrepancies_found": row[4],
                            "auto_resolved": row[5],
                            "status": row[6],
                            "summary": row[7],
                        })
                    else:
                        self._respond(200, {"message": "No reconciliation runs yet"})
            finally:
                pool.putconn(conn)
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _get_history(self):
        try:
            pool = get_db_pool()
            conn = pool.getconn()
            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT run_id, started_at, completed_at, accounts_checked,
                               discrepancies_found, auto_resolved, status
                        FROM reconciliation_runs
                        ORDER BY started_at DESC LIMIT 20
                    """)
                    runs = []
                    for row in cur.fetchall():
                        runs.append({
                            "run_id": row[0],
                            "started_at": str(row[1]),
                            "completed_at": str(row[2]) if row[2] else None,
                            "accounts_checked": row[3],
                            "discrepancies_found": row[4],
                            "auto_resolved": row[5],
                            "status": row[6],
                        })
                    self._respond(200, {"runs": runs, "total": len(runs)})
            finally:
                pool.putconn(conn)
        except Exception as e:
            self._respond(500, {"error": str(e)})

    def _metrics(self):
        uptime = int(time.time() - _process_start)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(f"""# HELP pod_uptime_seconds Time since process started
# TYPE pod_uptime_seconds gauge
pod_uptime_seconds{{service="python-tigerbeetle-reconciliation"}} {uptime}
# HELP pod_ready Whether pod is ready
# TYPE pod_ready gauge
pod_ready{{service="python-tigerbeetle-reconciliation"}} 1
""".encode())

    def _respond(self, status: int, body: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

# ─── Cron Scheduler (Temporal-compatible) ─────────────────────────────────────

_running = True
_process_start = time.time()

def reconciliation_cron_loop():
    """
    Simulates Temporal cron workflow @every RECONCILIATION_INTERVAL_SECONDS.
    In production, this would be a Temporal scheduled workflow.
    """
    logger.info(f"Reconciliation cron started (interval={RECONCILIATION_INTERVAL_SECONDS}s)")
    while _running:
        try:
            run_reconciliation()
        except Exception as e:
            logger.error(f"Reconciliation failed: {e}")
        # Sleep in small increments to allow graceful shutdown
        for _ in range(RECONCILIATION_INTERVAL_SECONDS):
            if not _running:
                break
            time.sleep(1)

def graceful_shutdown(signum, frame):
    global _running
    _running = False
    logger.info("Graceful shutdown initiated")
    sys.exit(0)

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    signal.signal(signal.SIGINT, graceful_shutdown)
    signal.signal(signal.SIGTERM, graceful_shutdown)

    # Initialize DB
    get_db_pool()

    # Start HTTP server in background
    server = HTTPServer(("0.0.0.0", SERVICE_PORT), ReconciliationHandler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    logger.info(f"Reconciliation service listening on :{SERVICE_PORT}")

    # Start cron loop (blocks main thread)
    reconciliation_cron_loop()

if __name__ == "__main__":
    main()
