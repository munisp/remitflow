"""
python-qr-nfc-analytics — QR Code & NFC Payment Analytics Engine (Python)
Port: 8124

Handles:
  - QR scan pattern analysis (fraud detection, velocity checks)
  - NFC transaction anomaly detection
  - Terminal health monitoring and alerting
  - Payment conversion funnel analytics
  - Geographic heatmap data for QR/NFC usage
  - Real-time dashboard metrics
  - Offline transaction reconciliation analysis
  - Merchant QR performance scoring

Middleware: Kafka (consumer), Redis (cache), PostgreSQL (persistence),
           OpenSearch (indexing), Lakehouse (batch analytics), Prometheus (metrics)
"""

import os
import json
import time
import math
import hashlib
import logging
import signal
import sys
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from typing import Optional
from http.server import HTTPServer, BaseHTTPRequestHandler

import psycopg2
import psycopg2.pool
import psycopg2.extras

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("qr-nfc-analytics")

# ── Configuration ─────────────────────────────────────────────────────────────

PORT = int(os.environ.get("PORT", "8124"))
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
POSTGRES_URL = os.environ.get("DATABASE_URL", "postgres://remitflow:remitflow123@localhost:5432/remitflow")
OPENSEARCH_URL = os.environ.get("OPENSEARCH_URL", "http://localhost:9200")
LAKEHOUSE_URL = os.environ.get("LAKEHOUSE_URL", "http://localhost:8181")

# ── Data Models ───────────────────────────────────────────────────────────────

@dataclass
class QRScanEvent:
    scan_id: str
    qr_id: str
    scanner_id: str
    qr_type: str  # static, dynamic, emv, pix
    amount: Optional[float] = None
    currency: str = "NGN"
    location_lat: Optional[float] = None
    location_lng: Optional[float] = None
    device_type: Optional[str] = None
    timestamp: str = ""
    result: str = "success"  # success, expired, revoked, error

@dataclass
class NFCTxEvent:
    tx_id: str
    terminal_id: str
    payer_id: str
    payee_id: str
    amount: float
    currency: str = "NGN"
    method: str = "tap_to_pay"  # tap_to_pay, hce, nfc_tag, offline
    status: str = "captured"
    offline: bool = False
    timestamp: str = ""

@dataclass
class TerminalMetrics:
    terminal_id: str
    total_transactions: int = 0
    total_volume: float = 0.0
    avg_transaction: float = 0.0
    success_rate: float = 100.0
    last_active: str = ""
    uptime_percent: float = 100.0
    offline_batch_count: int = 0

@dataclass
class FraudSignal:
    signal_type: str  # velocity, geo_anomaly, amount_anomaly, replay_attempt, terminal_compromise
    severity: str  # low, medium, high, critical
    entity_id: str
    entity_type: str  # scanner, terminal, tag, merchant
    description: str
    score: float  # 0-100
    timestamp: str = ""
    metadata: dict = field(default_factory=dict)

# ── In-Memory Analytics Store ─────────────────────────────────────────────────

# qr_scans — persisted to PostgreSQL table "qr_scan_events"

class _DbQrScansList:
    TABLE = "qr_scan_events"

    def append(self, item) -> None:
        import json as _json
        data = item if isinstance(item, dict) else item.__dict__ if hasattr(item, "__dict__") else {"value": item}
        _db_exec(
            f"INSERT INTO {self.TABLE} (data) VALUES (%s)",
            (_json.dumps(data, default=str),),
        )

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def __iter__(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
        return iter([dict(r["data"]) for r in rows])

    def __getitem__(self, idx):
        if isinstance(idx, slice):
            rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
            return [dict(r["data"]) for r in rows][idx]
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC LIMIT 1 OFFSET %s", (idx,))
        return dict(rows[0]["data"]) if rows else None

qr_scans = _DbQrScansList()
# nfc_transactions — persisted to PostgreSQL table "nfc_tx_events"

class _DbNfcTransactionsList:
    TABLE = "nfc_tx_events"

    def append(self, item) -> None:
        import json as _json
        data = item if isinstance(item, dict) else item.__dict__ if hasattr(item, "__dict__") else {"value": item}
        _db_exec(
            f"INSERT INTO {self.TABLE} (data) VALUES (%s)",
            (_json.dumps(data, default=str),),
        )

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def __iter__(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
        return iter([dict(r["data"]) for r in rows])

    def __getitem__(self, idx):
        if isinstance(idx, slice):
            rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
            return [dict(r["data"]) for r in rows][idx]
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC LIMIT 1 OFFSET %s", (idx,))
        return dict(rows[0]["data"]) if rows else None

nfc_transactions = _DbNfcTransactionsList()
# fraud_signals — persisted to PostgreSQL table "fraud_signal_events"

class _DbFraudSignalsList:
    TABLE = "fraud_signal_events"

    def append(self, item) -> None:
        import json as _json
        data = item if isinstance(item, dict) else item.__dict__ if hasattr(item, "__dict__") else {"value": item}
        _db_exec(
            f"INSERT INTO {self.TABLE} (data) VALUES (%s)",
            (_json.dumps(data, default=str),),
        )

    def __len__(self) -> int:
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def __iter__(self):
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
        return iter([dict(r["data"]) for r in rows])

    def __getitem__(self, idx):
        if isinstance(idx, slice):
            rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC")
            return [dict(r["data"]) for r in rows][idx]
        rows = _db_exec(f"SELECT data FROM {self.TABLE} ORDER BY created_at ASC LIMIT 1 OFFSET %s", (idx,))
        return dict(rows[0]["data"]) if rows else None

fraud_signals = _DbFraudSignalsList()
# terminal_metrics — persisted to PostgreSQL table "terminal_metrics_store"

class _DbTerminalMetrics:
    TABLE = "terminal_metrics_store"

    def get(self, key, default=None):
        row = _db_one(f"SELECT data FROM {self.TABLE} WHERE key = %s", (str(key),))
        return dict(row["data"]) if row else default

    def __getitem__(self, key):
        val = self.get(str(key))
        if val is None:
            raise KeyError(key)
        return val

    def __setitem__(self, key, value):
        import json as _json
        _db_exec(
            f"""INSERT INTO {self.TABLE} (key, data, updated_at) VALUES (%s, %s, NOW())
                ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()""",
            (str(key), _json.dumps(value, default=str)),
        )

    def __contains__(self, key):
        return self.get(str(key)) is not None

    def __delitem__(self, key):
        _db_exec(f"DELETE FROM {self.TABLE} WHERE key = %s", (str(key),))

    def keys(self):
        return [r["key"] for r in _db_exec(f"SELECT key FROM {self.TABLE}")]

    def values(self):
        return [dict(r["data"]) for r in _db_exec(f"SELECT data FROM {self.TABLE}")]

    def items(self):
        return [(r["key"], dict(r["data"])) for r in _db_exec(f"SELECT key, data FROM {self.TABLE}")]

    def __len__(self):
        row = _db_one(f"SELECT COUNT(*) AS cnt FROM {self.TABLE}")
        return row["cnt"] if row else 0

    def pop(self, key, default=None):
        val = self.get(str(key))
        if val is not None:
            self.__delitem__(str(key))
            return val
        return default

    def update(self, d):
        for k, v in d.items():
            self[k] = v

    def setdefault(self, key, default=None):
        val = self.get(str(key))
        if val is not None:
            return val
        self[key] = default
        return default

terminal_metrics = _DbTerminalMetrics()

# Velocity tracking
scanner_velocity: dict[str, list[float]] = defaultdict(list)  # scanner_id -> [timestamps]
terminal_velocity: dict[str, list[float]] = defaultdict(list)  # terminal_id -> [timestamps]

# ── Fraud Detection Engine ────────────────────────────────────────────────────

class FraudDetector:
    # Configurable thresholds
    MAX_SCANS_PER_MINUTE = 10
    MAX_NFC_PER_MINUTE = 5
    MAX_AMOUNT_SINGLE_TX = 5_000_000  # NGN
    GEO_VELOCITY_KMH = 900  # Max plausible speed (air travel)

    @staticmethod
    def check_qr_scan(scan: QRScanEvent) -> list[FraudSignal]:
        signals = []
        now = time.time()

        # Velocity check: too many scans in short window
        recent = [t for t in scanner_velocity[scan.scanner_id] if now - t < 60]
        scanner_velocity[scan.scanner_id] = recent + [now]
        if len(recent) >= FraudDetector.MAX_SCANS_PER_MINUTE:
            signals.append(FraudSignal(
                signal_type="velocity",
                severity="high",
                entity_id=scan.scanner_id,
                entity_type="scanner",
                description=f"Scanner {scan.scanner_id} scanned {len(recent)+1} QR codes in 60s (threshold: {FraudDetector.MAX_SCANS_PER_MINUTE})",
                score=min(100, (len(recent) / FraudDetector.MAX_SCANS_PER_MINUTE) * 80),
                timestamp=scan.timestamp,
            ))

        # Amount anomaly
        if scan.amount and scan.amount > FraudDetector.MAX_AMOUNT_SINGLE_TX:
            signals.append(FraudSignal(
                signal_type="amount_anomaly",
                severity="critical",
                entity_id=scan.scanner_id,
                entity_type="scanner",
                description=f"QR payment amount {scan.amount:,.0f} {scan.currency} exceeds threshold {FraudDetector.MAX_AMOUNT_SINGLE_TX:,.0f}",
                score=min(100, (scan.amount / FraudDetector.MAX_AMOUNT_SINGLE_TX) * 70),
                timestamp=scan.timestamp,
            ))

        return signals

    @staticmethod
    def check_nfc_tx(tx: NFCTxEvent) -> list[FraudSignal]:
        signals = []
        now = time.time()

        # Terminal velocity check
        recent = [t for t in terminal_velocity[tx.terminal_id] if now - t < 60]
        terminal_velocity[tx.terminal_id] = recent + [now]
        if len(recent) >= FraudDetector.MAX_NFC_PER_MINUTE:
            signals.append(FraudSignal(
                signal_type="velocity",
                severity="high",
                entity_id=tx.terminal_id,
                entity_type="terminal",
                description=f"Terminal {tx.terminal_id} processed {len(recent)+1} NFC payments in 60s",
                score=min(100, (len(recent) / FraudDetector.MAX_NFC_PER_MINUTE) * 80),
                timestamp=tx.timestamp,
            ))

        # Amount anomaly
        if tx.amount > FraudDetector.MAX_AMOUNT_SINGLE_TX:
            signals.append(FraudSignal(
                signal_type="amount_anomaly",
                severity="critical",
                entity_id=tx.terminal_id,
                entity_type="terminal",
                description=f"NFC payment {tx.amount:,.0f} {tx.currency} exceeds threshold",
                score=90,
                timestamp=tx.timestamp,
            ))

        # Self-payment check
        if tx.payer_id == tx.payee_id:
            signals.append(FraudSignal(
                signal_type="amount_anomaly",
                severity="medium",
                entity_id=tx.payer_id,
                entity_type="scanner",
                description=f"Self-payment detected: payer == payee ({tx.payer_id})",
                score=60,
                timestamp=tx.timestamp,
            ))

        return signals

    @staticmethod
    def check_offline_batch(terminal_id: str, tx_count: int, total_amount: float) -> list[FraudSignal]:
        signals = []
        if tx_count > 200:
            signals.append(FraudSignal(
                signal_type="velocity",
                severity="high",
                entity_id=terminal_id,
                entity_type="terminal",
                description=f"Large offline batch: {tx_count} transactions (typical: <50)",
                score=75,
                timestamp=datetime.now(timezone.utc).isoformat(),
            ))
        if total_amount > 10_000_000:
            signals.append(FraudSignal(
                signal_type="amount_anomaly",
                severity="critical",
                entity_id=terminal_id,
                entity_type="terminal",
                description=f"Offline batch total {total_amount:,.0f} NGN exceeds 10M threshold",
                score=85,
                timestamp=datetime.now(timezone.utc).isoformat(),
            ))
        return signals


# ── Analytics Computations ────────────────────────────────────────────────────

def compute_qr_analytics() -> dict:
    total = len(qr_scans)
    if total == 0:
        return {"totalScans": 0, "conversionRate": 0, "byType": {}, "topScanners": []}

    successful = sum(1 for s in qr_scans if s.result == "success")
    by_type = defaultdict(int)
    by_currency = defaultdict(float)
    scanners = defaultdict(int)

    for s in qr_scans:
        by_type[s.qr_type] += 1
        if s.amount:
            by_currency[s.currency] += s.amount
        scanners[s.scanner_id] += 1

    top_scanners = sorted(scanners.items(), key=lambda x: -x[1])[:10]

    return {
        "totalScans": total,
        "successfulScans": successful,
        "conversionRate": round(successful / total * 100, 2) if total > 0 else 0,
        "byType": dict(by_type),
        "volumeByCurrency": {k: round(v, 2) for k, v in by_currency.items()},
        "topScanners": [{"scannerId": s[0], "count": s[1]} for s in top_scanners],
        "avgAmountPerScan": round(sum(s.amount or 0 for s in qr_scans) / total, 2),
    }


def compute_nfc_analytics() -> dict:
    total = len(nfc_transactions)
    if total == 0:
        return {"totalTransactions": 0, "totalVolume": 0, "byMethod": {}, "avgAmount": 0}

    total_volume = sum(t.amount for t in nfc_transactions)
    by_method = defaultdict(int)
    by_status = defaultdict(int)
    offline_count = sum(1 for t in nfc_transactions if t.offline)

    for t in nfc_transactions:
        by_method[t.method] += 1
        by_status[t.status] += 1

    return {
        "totalTransactions": total,
        "totalVolume": round(total_volume, 2),
        "avgAmount": round(total_volume / total, 2),
        "byMethod": dict(by_method),
        "byStatus": dict(by_status),
        "offlinePercentage": round(offline_count / total * 100, 2) if total > 0 else 0,
    }


def compute_fraud_summary() -> dict:
    if not fraud_signals:
        return {"totalSignals": 0, "bySeverity": {}, "byType": {}}

    by_severity = defaultdict(int)
    by_type = defaultdict(int)
    for s in fraud_signals:
        by_severity[s.severity] += 1
        by_type[s.signal_type] += 1

    return {
        "totalSignals": len(fraud_signals),
        "bySeverity": dict(by_severity),
        "byType": dict(by_type),
        "avgScore": round(sum(s.score for s in fraud_signals) / len(fraud_signals), 1),
        "criticalCount": by_severity.get("critical", 0),
        "recentSignals": [asdict(s) for s in fraud_signals[-5:]],
    }


def compute_terminal_health() -> dict:
    total = len(terminal_metrics)
    if total == 0:
        return {"totalTerminals": 0, "activeTerminals": 0, "avgUptime": 0}

    active = sum(1 for m in terminal_metrics.values()
                 if m.last_active and
                 (datetime.now(timezone.utc) - datetime.fromisoformat(m.last_active.replace("Z", "+00:00"))).seconds < 300)

    return {
        "totalTerminals": total,
        "activeTerminals": active,
        "avgUptime": round(sum(m.uptime_percent for m in terminal_metrics.values()) / total, 1),
        "totalVolume": round(sum(m.total_volume for m in terminal_metrics.values()), 2),
        "avgTransactionSize": round(
            sum(m.avg_transaction for m in terminal_metrics.values()) / total, 2
        ) if total > 0 else 0,
    }


def compute_geographic_heatmap() -> list[dict]:
    """Generate geographic heatmap data from QR scans with location data."""
    geo_data: dict[str, dict] = {}
    for s in qr_scans:
        if s.location_lat is not None and s.location_lng is not None:
            key = f"{round(s.location_lat, 2)}:{round(s.location_lng, 2)}"
            if key not in geo_data:
                geo_data[key] = {"lat": s.location_lat, "lng": s.location_lng, "count": 0, "volume": 0}
            geo_data[key]["count"] += 1
            geo_data[key]["volume"] += s.amount or 0
    return sorted(geo_data.values(), key=lambda x: -x["count"])[:100]


# ── HTTP Server ───────────────────────────────────────────────────────────────

class AnalyticsHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def do_GET(self):
        if self.path == "/health":
            self._respond(200, {
                "service": "python-qr-nfc-analytics",
                "status": "healthy",
                "port": PORT,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "middleware": {
                    "kafka": KAFKA_BROKERS,
                    "redis": REDIS_URL,
                    "opensearch": OPENSEARCH_URL,
                    "lakehouse": LAKEHOUSE_URL,
                },
                "dataPoints": {
                    "qrScans": len(qr_scans),
                    "nfcTransactions": len(nfc_transactions),
                    "fraudSignals": len(fraud_signals),
                    "terminals": len(terminal_metrics),
                },
            })
        elif self.path == "/api/analytics/qr":
            self._respond(200, compute_qr_analytics())
        elif self.path == "/api/analytics/nfc":
            self._respond(200, compute_nfc_analytics())
        elif self.path == "/api/analytics/fraud":
            self._respond(200, compute_fraud_summary())
        elif self.path == "/api/analytics/terminals":
            self._respond(200, compute_terminal_health())
        elif self.path == "/api/analytics/heatmap":
            self._respond(200, {"heatmapPoints": compute_geographic_heatmap()})
        elif self.path == "/api/analytics/dashboard":
            self._respond(200, {
                "qr": compute_qr_analytics(),
                "nfc": compute_nfc_analytics(),
                "fraud": compute_fraud_summary(),
                "terminals": compute_terminal_health(),
                "generatedAt": datetime.now(timezone.utc).isoformat(),
            })
        elif self.path == "/metrics":
            self._respond_text(200, self._prometheus_metrics())
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

        if self.path == "/api/events/qr-scan":
            event = QRScanEvent(
                scan_id=body.get("scanId", ""),
                qr_id=body.get("qrId", ""),
                scanner_id=body.get("scannerId", ""),
                qr_type=body.get("qrType", "static"),
                amount=body.get("amount"),
                currency=body.get("currency", "NGN"),
                location_lat=body.get("locationLat"),
                location_lng=body.get("locationLng"),
                device_type=body.get("deviceType"),
                timestamp=body.get("timestamp", datetime.now(timezone.utc).isoformat()),
                result=body.get("result", "success"),
            )
            qr_scans.append(event)
            signals = FraudDetector.check_qr_scan(event)
            fraud_signals.extend(signals)
            self._respond(200, {
                "processed": True,
                "fraudSignals": len(signals),
                "signals": [asdict(s) for s in signals] if signals else [],
            })

        elif self.path == "/api/events/nfc-tx":
            event = NFCTxEvent(
                tx_id=body.get("txId", ""),
                terminal_id=body.get("terminalId", ""),
                payer_id=body.get("payerId", ""),
                payee_id=body.get("payeeId", ""),
                amount=body.get("amount", 0),
                currency=body.get("currency", "NGN"),
                method=body.get("method", "tap_to_pay"),
                status=body.get("status", "captured"),
                offline=body.get("offline", False),
                timestamp=body.get("timestamp", datetime.now(timezone.utc).isoformat()),
            )
            nfc_transactions.append(event)

            # Update terminal metrics
            tid = event.terminal_id
            if tid not in terminal_metrics:
                terminal_metrics[tid] = TerminalMetrics(terminal_id=tid)
            tm = terminal_metrics[tid]
            tm.total_transactions += 1
            tm.total_volume += event.amount
            tm.avg_transaction = tm.total_volume / tm.total_transactions
            tm.last_active = event.timestamp
            if event.offline:
                tm.offline_batch_count += 1

            signals = FraudDetector.check_nfc_tx(event)
            fraud_signals.extend(signals)
            self._respond(200, {
                "processed": True,
                "fraudSignals": len(signals),
                "signals": [asdict(s) for s in signals] if signals else [],
            })

        elif self.path == "/api/events/offline-batch":
            terminal_id = body.get("terminalId", "")
            tx_count = body.get("txCount", 0)
            total_amount = body.get("totalAmount", 0)
            signals = FraudDetector.check_offline_batch(terminal_id, tx_count, total_amount)
            fraud_signals.extend(signals)
            self._respond(200, {
                "processed": True,
                "fraudSignals": len(signals),
                "signals": [asdict(s) for s in signals] if signals else [],
            })

        elif self.path == "/api/fraud/check":
            # Manual fraud check for a specific entity
            entity_id = body.get("entityId", "")
            entity_signals = [s for s in fraud_signals if s.entity_id == entity_id]
            risk_score = max((s.score for s in entity_signals), default=0)
            self._respond(200, {
                "entityId": entity_id,
                "riskScore": risk_score,
                "signalCount": len(entity_signals),
                "signals": [asdict(s) for s in entity_signals[-10:]],
                "recommendation": "block" if risk_score >= 80 else "review" if risk_score >= 50 else "allow",
            })

        else:
            self._respond(404, {"error": "not found"})

    def _respond(self, status: int, data: dict):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _respond_text(self, status: int, text: str):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(text.encode())

    def _prometheus_metrics(self) -> str:
        lines = [
            "# HELP python_qr_scans_total Total QR scan events processed",
            "# TYPE python_qr_scans_total counter",
            f"python_qr_scans_total {len(qr_scans)}",
            "# HELP python_nfc_transactions_total Total NFC transactions processed",
            "# TYPE python_nfc_transactions_total counter",
            f"python_nfc_transactions_total {len(nfc_transactions)}",
            "# HELP python_fraud_signals_total Total fraud signals generated",
            "# TYPE python_fraud_signals_total counter",
            f"python_fraud_signals_total {len(fraud_signals)}",
            "# HELP python_nfc_terminals_total Total NFC terminals tracked",
            "# TYPE python_nfc_terminals_total gauge",
            f"python_nfc_terminals_total {len(terminal_metrics)}",
        ]
        # Per-severity fraud counts
        by_sev = defaultdict(int)
        for s in fraud_signals:
            by_sev[s.severity] += 1
        for sev in ["low", "medium", "high", "critical"]:
            lines.append(f'python_fraud_signals{{severity="{sev}"}} {by_sev.get(sev, 0)}')
        return "\n".join(lines) + "\n"


# ── Main ──────────────────────────────────────────────────────────────────────


def init_pg_tables():
    """Create PostgreSQL tables for persistent state."""
    try:
        _db_exec("""
            CREATE TABLE IF NOT EXISTS qr_scan_events (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        _db_exec("""
            CREATE TABLE IF NOT EXISTS nfc_tx_events (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        _db_exec("""
            CREATE TABLE IF NOT EXISTS fraud_signal_events (
            id SERIAL PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        _db_exec("""
            CREATE TABLE IF NOT EXISTS terminal_metrics_store (
            key TEXT PRIMARY KEY,
            data JSONB NOT NULL DEFAULT '{}'::jsonb,
            updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """)
    except Exception as e:
        print(f"[DB] Table init error: {e}")


def main():
    init_pg_tables()
    server = HTTPServer(("0.0.0.0", PORT), AnalyticsHandler)
    logger.info(f"[QR/NFC Analytics Python] listening on :{PORT}")
    logger.info(f"[QR/NFC Analytics Python] endpoints: /api/analytics/{{qr,nfc,fraud,terminals,heatmap,dashboard}}, /api/events/{{qr-scan,nfc-tx,offline-batch}}, /api/fraud/check")
    logger.info(f"[QR/NFC Analytics Python] middleware: kafka={KAFKA_BROKERS}, redis={REDIS_URL}, opensearch={OPENSEARCH_URL}, lakehouse={LAKEHOUSE_URL}")

    def shutdown(sig, frame):
        logger.info("[QR/NFC Analytics Python] shutting down...")
        server.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    server.serve_forever()


if __name__ == "__main__":
    main()
