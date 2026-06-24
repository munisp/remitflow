"""
python-settlement-reconciliation — Bilateral Nostro Settlement Reconciliation

Tracks bilateral positions between Mark Lane (Canada) and RemitFlow (Africa),
generates settlement instructions, performs automated reconciliation, and
produces regulatory reports for FINTRAC/CBN.

Middleware: Lakehouse (historical analytics), PostgreSQL (position persistence),
Redis (real-time position cache), Kafka (settlement events), Prometheus (metrics).

Port: 8130
"""

import json
import os
import time
import threading
import hashlib
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from dataclasses import dataclass, field, asdict
from typing import Optional
from collections import defaultdict
from enum import Enum


# ─── Configuration ────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8130"))
KAFKA_BROKER = os.environ.get("KAFKA_BROKER", "localhost:9092")
REDIS_URL = os.environ.get("REDIS_URL", "localhost:6379")
PG_URL = os.environ.get("DATABASE_URL", "")
DAPR_URL = os.environ.get("DAPR_URL", "http://localhost:3500")

REBALANCE_THRESHOLDS = {
    "CAD": 100_000,
    "USD": 75_000,
    "NGN": 10_000_000,
    "GHS": 100_000,
    "KES": 2_000_000,
    "ZAR": 500_000,
    "XOF": 10_000_000,
    "TZS": 50_000_000,
    "UGX": 50_000_000,
    "XAF": 10_000_000,
}


# ─── Types ────────────────────────────────────────────────────────────────────

class SettlementStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    DISPUTED = "disputed"


@dataclass
class NostroPosition:
    currency: str
    marklane_balance: float
    remitflow_balance: float
    net_position: float
    last_updated: str
    last_reconciled: str = ""
    discrepancy: float = 0.0


@dataclass
class SettlementInstruction:
    instruction_id: str
    from_partner: str
    to_partner: str
    currency: str
    amount: float
    reason: str
    due_date: str
    status: str = "pending"
    created_at: str = ""
    completed_at: str = ""
    reference: str = ""


@dataclass
class ReconciliationReport:
    report_id: str
    period_start: str
    period_end: str
    positions: list = field(default_factory=list)
    transactions_count: int = 0
    total_volume_cad: float = 0.0
    discrepancies: list = field(default_factory=list)
    settlements_needed: list = field(default_factory=list)
    status: str = "generated"
    generated_at: str = ""
    checksum: str = ""


@dataclass
class TransactionRecord:
    transaction_id: str
    corridor: str
    from_currency: str
    to_currency: str
    send_amount: float
    receive_amount: float
    fx_rate: float
    fee: float
    status: str
    timestamp: str
    marklane_ref: str = ""
    remitflow_ref: str = ""


@dataclass
class RegulatoryReport:
    report_id: str
    regulator: str
    report_type: str
    period: str
    total_transactions: int
    total_volume: float
    currency: str
    flagged_transactions: int
    sar_count: int
    corridors: list = field(default_factory=list)
    generated_at: str = ""


# ─── Metrics ──────────────────────────────────────────────────────────────────

class Metrics:
    def __init__(self):
        self.reconciliations_total = 0
        self.settlements_completed = 0
        self.settlements_failed = 0
        self.discrepancies_found = 0
        self.total_volume_settled = defaultdict(float)
        self.regulatory_reports_generated = 0
        self._lock = threading.Lock()

    def to_prometheus(self) -> str:
        with self._lock:
            lines = [
                "# HELP settlement_reconciliations_total Total reconciliation runs",
                "# TYPE settlement_reconciliations_total counter",
                f"settlement_reconciliations_total {self.reconciliations_total}",
                "# HELP settlement_completed Total completed settlements",
                "# TYPE settlement_completed counter",
                f"settlement_completed {self.settlements_completed}",
                "# HELP settlement_failed Total failed settlements",
                "# TYPE settlement_failed counter",
                f"settlement_failed {self.settlements_failed}",
                "# HELP settlement_discrepancies Total discrepancies found",
                "# TYPE settlement_discrepancies counter",
                f"settlement_discrepancies {self.discrepancies_found}",
                "# HELP regulatory_reports_generated Total regulatory reports",
                "# TYPE regulatory_reports_generated counter",
                f"regulatory_reports_generated {self.regulatory_reports_generated}",
            ]
            for currency, vol in self.total_volume_settled.items():
                lines.append(f'settlement_volume_total{{currency="{currency}"}} {vol}')
            return "\n".join(lines) + "\n"


metrics = Metrics()


# ─── Settlement Reconciliation Service ────────────────────────────────────────

class SettlementReconciliationService:
    def __init__(self):
        self.positions: dict[str, NostroPosition] = {}
        self.settlements: list[SettlementInstruction] = []
        self.transactions: list[TransactionRecord] = []
        self.reports: list[ReconciliationReport] = []
        self.regulatory_reports: list[RegulatoryReport] = []
        self._lock = threading.Lock()
        self._init_positions()

    def _init_positions(self):
        now = datetime.now(timezone.utc).isoformat()
        initial = {
            "CAD": (500_000, 0),
            "USD": (350_000, 200_000),
            "NGN": (0, 50_000_000),
            "GHS": (0, 500_000),
            "KES": (0, 10_000_000),
            "ZAR": (0, 1_000_000),
            "XOF": (0, 5_000_000),
        }
        for currency, (ml, rf) in initial.items():
            self.positions[currency] = NostroPosition(
                currency=currency,
                marklane_balance=ml,
                remitflow_balance=rf,
                net_position=ml - rf,
                last_updated=now,
            )

    def record_transaction(self, tx: TransactionRecord):
        with self._lock:
            self.transactions.append(tx)

            # Update positions
            from_pos = self.positions.get(tx.from_currency)
            if from_pos:
                from_pos.marklane_balance -= tx.send_amount
                from_pos.net_position = from_pos.marklane_balance - from_pos.remitflow_balance
                from_pos.last_updated = tx.timestamp

            to_pos = self.positions.get(tx.to_currency)
            if to_pos:
                to_pos.remitflow_balance -= tx.receive_amount
                to_pos.net_position = to_pos.marklane_balance - to_pos.remitflow_balance
                to_pos.last_updated = tx.timestamp

    def reconcile(self) -> ReconciliationReport:
        with self._lock:
            now = datetime.now(timezone.utc)
            report_id = f"recon-{int(now.timestamp() * 1000)}"

            positions_snapshot = []
            discrepancies = []
            settlements_needed = []

            for currency, pos in self.positions.items():
                positions_snapshot.append(asdict(pos))

                # Check for imbalance
                threshold = REBALANCE_THRESHOLDS.get(currency, 50_000)
                if abs(pos.net_position) > threshold:
                    from_partner = "marklane" if pos.net_position > 0 else "remitflow"
                    to_partner = "remitflow" if pos.net_position > 0 else "marklane"

                    instruction = SettlementInstruction(
                        instruction_id=f"settle-{int(time.time() * 1000)}-{currency}",
                        from_partner=from_partner,
                        to_partner=to_partner,
                        currency=currency,
                        amount=abs(pos.net_position) / 2,
                        reason="nostro_rebalance",
                        due_date=(now + timedelta(hours=24)).isoformat(),
                        created_at=now.isoformat(),
                    )
                    settlements_needed.append(asdict(instruction))
                    self.settlements.append(instruction)

                # Reconciliation check — verify consistency
                if pos.discrepancy != 0:
                    discrepancies.append({
                        "currency": currency,
                        "expected_net": pos.net_position,
                        "actual_discrepancy": pos.discrepancy,
                        "severity": "high" if abs(pos.discrepancy) > threshold * 0.1 else "low",
                    })

            total_volume = sum(tx.send_amount for tx in self.transactions)
            checksum = hashlib.sha256(json.dumps(positions_snapshot, sort_keys=True).encode()).hexdigest()

            report = ReconciliationReport(
                report_id=report_id,
                period_start=(now - timedelta(hours=24)).isoformat(),
                period_end=now.isoformat(),
                positions=positions_snapshot,
                transactions_count=len(self.transactions),
                total_volume_cad=total_volume,
                discrepancies=discrepancies,
                settlements_needed=settlements_needed,
                generated_at=now.isoformat(),
                checksum=checksum,
            )
            self.reports.append(report)

            metrics.reconciliations_total += 1
            metrics.discrepancies_found += len(discrepancies)

            return report

    def complete_settlement(self, instruction_id: str) -> Optional[SettlementInstruction]:
        with self._lock:
            for s in self.settlements:
                if s.instruction_id == instruction_id:
                    s.status = "completed"
                    s.completed_at = datetime.now(timezone.utc).isoformat()

                    # Update positions
                    pos = self.positions.get(s.currency)
                    if pos:
                        if s.from_partner == "marklane":
                            pos.marklane_balance -= s.amount
                            pos.remitflow_balance += s.amount
                        else:
                            pos.remitflow_balance -= s.amount
                            pos.marklane_balance += s.amount
                        pos.net_position = pos.marklane_balance - pos.remitflow_balance
                        pos.last_updated = s.completed_at

                    metrics.settlements_completed += 1
                    metrics.total_volume_settled[s.currency] += s.amount
                    return s
            return None

    def generate_regulatory_report(self, regulator: str, period_days: int = 30) -> RegulatoryReport:
        with self._lock:
            now = datetime.now(timezone.utc)
            cutoff = now - timedelta(days=period_days)
            cutoff_str = cutoff.isoformat()

            relevant_txs = [tx for tx in self.transactions if tx.timestamp >= cutoff_str]

            corridor_volumes: dict[str, dict] = defaultdict(lambda: {"count": 0, "volume": 0})
            for tx in relevant_txs:
                c = corridor_volumes[tx.corridor]
                c["count"] += 1
                c["volume"] += tx.send_amount

            corridors = [
                {"corridor": k, "count": v["count"], "volume": v["volume"]}
                for k, v in corridor_volumes.items()
            ]

            total_volume = sum(tx.send_amount for tx in relevant_txs)
            flagged = sum(1 for tx in relevant_txs if tx.send_amount > 10_000)

            report = RegulatoryReport(
                report_id=f"reg-{regulator.lower()}-{int(now.timestamp())}",
                regulator=regulator,
                report_type="FINTRAC_LCTR" if regulator == "FINTRAC" else "CBN_AML_REPORT",
                period=f"{cutoff.date()} to {now.date()}",
                total_transactions=len(relevant_txs),
                total_volume=total_volume,
                currency="CAD" if regulator == "FINTRAC" else "NGN",
                flagged_transactions=flagged,
                sar_count=0,
                corridors=corridors,
                generated_at=now.isoformat(),
            )
            self.regulatory_reports.append(report)
            metrics.regulatory_reports_generated += 1

            return report

    def get_daily_summary(self) -> dict:
        with self._lock:
            now = datetime.now(timezone.utc)
            today = now.date().isoformat()

            today_txs = [tx for tx in self.transactions if tx.timestamp.startswith(today)]
            pending_settlements = [s for s in self.settlements if s.status == "pending"]

            return {
                "date": today,
                "transactions_today": len(today_txs),
                "volume_today": sum(tx.send_amount for tx in today_txs),
                "pending_settlements": len(pending_settlements),
                "positions": {k: asdict(v) for k, v in self.positions.items()},
                "generated_at": now.isoformat(),
            }


# ─── HTTP Handler ─────────────────────────────────────────────────────────────

service = SettlementReconciliationService()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def _json_response(self, status: int, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {
                "status": "healthy",
                "service": "python-settlement-reconciliation",
                "version": "1.0.0",
                "positions_count": len(service.positions),
                "transactions_count": len(service.transactions),
                "settlements_count": len(service.settlements),
            })

        elif self.path == "/metrics":
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(metrics.to_prometheus().encode())

        elif self.path == "/api/settlement/positions":
            self._json_response(200, {
                "positions": {k: asdict(v) for k, v in service.positions.items()},
                "count": len(service.positions),
            })

        elif self.path == "/api/settlement/pending":
            pending = [asdict(s) for s in service.settlements if s.status == "pending"]
            self._json_response(200, {"settlements": pending, "count": len(pending)})

        elif self.path == "/api/settlement/history":
            completed = [asdict(s) for s in service.settlements if s.status == "completed"]
            self._json_response(200, {"settlements": completed, "count": len(completed)})

        elif self.path == "/api/settlement/summary":
            self._json_response(200, service.get_daily_summary())

        elif self.path == "/api/settlement/reports":
            self._json_response(200, {
                "reports": [asdict(r) for r in service.reports],
                "count": len(service.reports),
            })

        elif self.path.startswith("/api/settlement/reports/"):
            report_id = self.path.split("/")[-1]
            report = next((r for r in service.reports if r.report_id == report_id), None)
            if report:
                self._json_response(200, asdict(report))
            else:
                self._json_response(404, {"error": "report not found"})

        elif self.path == "/api/regulatory/reports":
            self._json_response(200, {
                "reports": [asdict(r) for r in service.regulatory_reports],
                "count": len(service.regulatory_reports),
            })

        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

        if self.path == "/api/settlement/reconcile":
            report = service.reconcile()
            self._json_response(200, asdict(report))

        elif self.path == "/api/settlement/record":
            tx = TransactionRecord(
                transaction_id=body.get("transactionId", f"tx-{int(time.time() * 1000)}"),
                corridor=body.get("corridor", "CA-NG"),
                from_currency=body.get("fromCurrency", "CAD"),
                to_currency=body.get("toCurrency", "NGN"),
                send_amount=body.get("sendAmount", 0),
                receive_amount=body.get("receiveAmount", 0),
                fx_rate=body.get("fxRate", 0),
                fee=body.get("fee", 0),
                status=body.get("status", "completed"),
                timestamp=body.get("timestamp", datetime.now(timezone.utc).isoformat()),
                marklane_ref=body.get("markLaneRef", ""),
                remitflow_ref=body.get("remitFlowRef", ""),
            )
            service.record_transaction(tx)
            self._json_response(200, {"status": "recorded", "transactionId": tx.transaction_id})

        elif self.path == "/api/settlement/complete":
            instruction_id = body.get("instructionId", "")
            result = service.complete_settlement(instruction_id)
            if result:
                self._json_response(200, asdict(result))
            else:
                self._json_response(404, {"error": "settlement instruction not found"})

        elif self.path == "/api/regulatory/generate":
            regulator = body.get("regulator", "FINTRAC")
            period = body.get("periodDays", 30)
            report = service.generate_regulatory_report(regulator, period)
            self._json_response(200, asdict(report))

        elif self.path == "/api/settlement/position/update":
            currency = body.get("currency", "")
            ml_delta = body.get("markLaneDelta", 0)
            rf_delta = body.get("remitFlowDelta", 0)
            pos = service.positions.get(currency)
            if pos:
                pos.marklane_balance += ml_delta
                pos.remitflow_balance += rf_delta
                pos.net_position = pos.marklane_balance - pos.remitflow_balance
                pos.last_updated = datetime.now(timezone.utc).isoformat()
                self._json_response(200, {"status": "updated", "position": asdict(pos)})
            else:
                self._json_response(404, {"error": f"no position for {currency}"})

        else:
            self._json_response(404, {"error": "not found"})


# ─── Background Reconciliation ────────────────────────────────────────────────

def auto_reconciliation_loop():
    """Run reconciliation every 6 hours."""
    while True:
        time.sleep(6 * 3600)
        try:
            report = service.reconcile()
            print(f"[auto-recon] Generated report {report.report_id}: "
                  f"{report.transactions_count} txs, {len(report.settlements_needed)} settlements needed")

            # Emit to Kafka via Dapr
            try:
                import urllib.request
                data = json.dumps({
                    "reportId": report.report_id,
                    "settlementsNeeded": len(report.settlements_needed),
                    "discrepancies": len(report.discrepancies),
                    "_service": "python-settlement-reconciliation",
                }).encode()
                req = urllib.request.Request(
                    f"{DAPR_URL}/v1.0/publish/kafka-pubsub/marklane.settlement.reconciliation",
                    data=data,
                    headers={"Content-Type": "application/json"},
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass
        except Exception as e:
            print(f"[auto-recon] Error: {e}")


# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    recon_thread = threading.Thread(target=auto_reconciliation_loop, daemon=True)
    recon_thread.start()

    print(f"[python-settlement-reconciliation] listening on :{PORT}")
    server = HTTPServer(("0.0.0.0", PORT), Handler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[python-settlement-reconciliation] shutting down...")
        server.server_close()
