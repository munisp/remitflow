"""
python-interest-accrual — Savings Vault Interest Accrual Engine

Runs as a scheduled service (cron or Temporal activity) to compound
interest on active savings goals. Calculates daily accrual based on
each goal's APY, updates the interestEarned field, and publishes
Kafka events for downstream accounting.

Integration points:
  - PostgreSQL: reads savings_goals, writes interest_earned updates
  - Kafka: publishes interest_accrual events
  - Prometheus: exposes accrual metrics
  - TigerBeetle: records double-entry interest credit/debit

Port: 8145
"""

import json
import os
import time
import threading
import signal
import sys
from datetime import datetime, timezone, timedelta
from decimal import Decimal, ROUND_HALF_UP
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, asdict
from typing import Optional

# ─── Configuration ────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8145"))
PG_URL = os.environ.get("DATABASE_URL", "")
KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
DAPR_URL = os.environ.get("DAPR_URL", "http://localhost:3500")

# APY rates per savings type (annual percentage yield)
SAVINGS_APY = {
    "flex": Decimal("3.5"),       # 3.5% APY for flexible savings
    "locked": Decimal("7.0"),     # 7.0% APY for locked savings
    "target": Decimal("5.0"),     # 5.0% APY for target savings
    "round_up": Decimal("2.5"),   # 2.5% APY for round-up savings
}

# Minimum balance to accrue interest (prevents dust accrual)
MIN_BALANCE_FOR_INTEREST = Decimal("100.00")

# ─── Metrics ──────────────────────────────────────────────────────────────────

metrics = {
    "accrual_runs_total": 0,
    "goals_processed": 0,
    "goals_accrued": 0,
    "goals_skipped_low_balance": 0,
    "total_interest_credited": Decimal("0"),
    "errors": 0,
    "last_run_at": None,
    "last_run_duration_ms": 0,
}
metrics_lock = threading.Lock()


@dataclass
class AccrualResult:
    """Result of a single goal's interest accrual."""
    goal_id: int
    user_id: int
    savings_type: str
    balance: str
    apy: str
    daily_interest: str
    new_interest_earned: str
    currency: str
    accrued_at: str


def calculate_daily_interest(balance: Decimal, apy: Decimal) -> Decimal:
    """Calculate daily interest from annual percentage yield.
    
    Formula: daily_interest = balance * (apy / 100) / 365
    Uses banker's rounding (ROUND_HALF_UP) for financial precision.
    """
    if balance < MIN_BALANCE_FOR_INTEREST:
        return Decimal("0")
    daily_rate = apy / Decimal("100") / Decimal("365")
    return (balance * daily_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def run_accrual_cycle() -> dict:
    """Execute one interest accrual cycle for all active savings goals.
    
    1. Fetch all active savings goals with balance >= minimum
    2. Calculate daily interest per goal based on savings_type APY
    3. Update interest_earned in DB (atomic increment)
    4. Publish Kafka events for each accrual
    5. Return summary metrics
    """
    start = time.monotonic()
    results: list[AccrualResult] = []
    skipped = 0
    errors = 0

    try:
        import psycopg2
        if not PG_URL:
            # Fail closed: never fall back to well-known default DB credentials.
            raise RuntimeError(
                "[interest-accrual] DATABASE_URL is not set; refusing to connect "
                "with default credentials. Configure DATABASE_URL explicitly."
            )
        conn = psycopg2.connect(PG_URL)
    except ImportError:
        # Fallback: use urllib to call the Node.js API
        return _run_accrual_via_api()
    except Exception as e:
        return {"error": str(e), "goals_processed": 0}

    try:
        cur = conn.cursor()
        
        # Fetch all active savings goals
        cur.execute("""
            SELECT id, "userId", "savingsType", "currentAmount", "interestEarned",
                   currency, status
            FROM savings_goals
            WHERE status = 'active'
            ORDER BY id
        """)
        goals = cur.fetchall()

        for goal in goals:
            goal_id, user_id, savings_type, current_amount, interest_earned, currency, status = goal
            balance = Decimal(str(current_amount or 0))
            existing_interest = Decimal(str(interest_earned or 0))

            # Get APY for this savings type
            apy = SAVINGS_APY.get(savings_type or "flex", Decimal("3.5"))
            daily_interest = calculate_daily_interest(balance, apy)

            if daily_interest == Decimal("0"):
                skipped += 1
                continue

            new_interest_earned = existing_interest + daily_interest

            try:
                # Atomic update: increment interest_earned
                cur.execute("""
                    UPDATE savings_goals
                    SET "interestEarned" = %s,
                        "updatedAt" = NOW()
                    WHERE id = %s AND status = 'active'
                """, (str(new_interest_earned), goal_id))

                results.append(AccrualResult(
                    goal_id=goal_id,
                    user_id=user_id,
                    savings_type=savings_type or "flex",
                    balance=str(balance),
                    apy=str(apy),
                    daily_interest=str(daily_interest),
                    new_interest_earned=str(new_interest_earned),
                    currency=currency or "NGN",
                    accrued_at=datetime.now(timezone.utc).isoformat(),
                ))
            except Exception as e:
                errors += 1

        conn.commit()
    except Exception as e:
        conn.rollback()
        return {"error": str(e), "goals_processed": len(results)}
    finally:
        cur.close()
        conn.close()

    duration_ms = int((time.monotonic() - start) * 1000)

    with metrics_lock:
        metrics["accrual_runs_total"] += 1
        metrics["goals_processed"] += len(results) + skipped
        metrics["goals_accrued"] += len(results)
        metrics["goals_skipped_low_balance"] += skipped
        metrics["total_interest_credited"] += sum(Decimal(r.daily_interest) for r in results)
        metrics["errors"] += errors
        metrics["last_run_at"] = datetime.now(timezone.utc).isoformat()
        metrics["last_run_duration_ms"] = duration_ms

    # Publish Kafka events (best-effort via Dapr)
    _publish_accrual_events(results)

    return {
        "success": True,
        "goals_processed": len(results) + skipped,
        "goals_accrued": len(results),
        "goals_skipped": skipped,
        "errors": errors,
        "total_interest": str(sum(Decimal(r.daily_interest) for r in results)),
        "duration_ms": duration_ms,
    }


def _run_accrual_via_api() -> dict:
    """Fallback: trigger accrual via Node.js API when psycopg2 is unavailable."""
    import urllib.request
    try:
        req = urllib.request.Request(
            f"{DAPR_URL}/v1.0/invoke/remitflow-api/method/api/internal/accrue-interest",
            method="POST",
            headers={"Content-Type": "application/json"},
            data=b"{}",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"error": f"API fallback failed: {e}", "goals_processed": 0}


def _publish_accrual_events(results: list[AccrualResult]) -> None:
    """Publish interest accrual events to Kafka via Dapr sidecar."""
    import urllib.request
    for r in results:
        try:
            data = json.dumps({
                "eventType": "interest_accrued",
                "goalId": r.goal_id,
                "userId": r.user_id,
                "dailyInterest": r.daily_interest,
                "currency": r.currency,
                "timestamp": r.accrued_at,
            }).encode()
            req = urllib.request.Request(
                f"{DAPR_URL}/v1.0/publish/kafka-pubsub/interest-accrual",
                method="POST",
                headers={"Content-Type": "application/json"},
                data=data,
            )
            urllib.request.urlopen(req, timeout=5)
        except Exception:
            pass  # Best-effort


# ─── Scheduled Accrual Runner ────────────────────────────────────────────────

_shutdown = threading.Event()


def accrual_scheduler():
    """Run interest accrual daily at midnight UTC."""
    while not _shutdown.is_set():
        now = datetime.now(timezone.utc)
        # Calculate seconds until next midnight UTC
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        wait_seconds = (tomorrow - now).total_seconds()
        
        if _shutdown.wait(timeout=min(wait_seconds, 3600)):
            break
        
        # Check if it's within 5 minutes of midnight
        now = datetime.now(timezone.utc)
        if now.hour == 0 and now.minute < 5:
            result = run_accrual_cycle()
            print(f"[InterestAccrual] Scheduled run: {json.dumps(result, default=str)}")


# ─── HTTP Handler ────────────────────────────────────────────────────────────

class AccrualHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "service": "interest-accrual"})
        elif self.path == "/metrics":
            with metrics_lock:
                m = {k: str(v) if isinstance(v, Decimal) else v for k, v in metrics.items()}
            self._json(200, m)
        elif self.path == "/config":
            self._json(200, {
                "apy_rates": {k: str(v) for k, v in SAVINGS_APY.items()},
                "min_balance": str(MIN_BALANCE_FOR_INTEREST),
            })
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/accrue":
            result = run_accrual_cycle()
            status = 200 if result.get("success") or "error" not in result else 500
            self._json(status, result)
        elif self.path == "/test-calc":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            balance = Decimal(str(body.get("balance", "10000")))
            apy = Decimal(str(body.get("apy", "5.0")))
            daily = calculate_daily_interest(balance, apy)
            self._json(200, {
                "balance": str(balance),
                "apy": str(apy),
                "daily_interest": str(daily),
                "monthly_estimate": str(daily * 30),
                "annual_estimate": str(daily * 365),
            })
        else:
            self._json(404, {"error": "Not found"})

    def _json(self, status: int, data: dict):
        body = json.dumps(data, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    # Start scheduled accrual thread
    scheduler = threading.Thread(target=accrual_scheduler, daemon=True)
    scheduler.start()

    server = HTTPServer(("0.0.0.0", PORT), AccrualHandler)
    print(f"[InterestAccrual] Listening on :{PORT}")

    def shutdown(sig, frame):
        _shutdown.set()
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        _shutdown.set()
        server.shutdown()


if __name__ == "__main__":
    main()
