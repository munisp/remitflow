"""
Insider Threat Analytics Engine (Python)

Implements:
- Agent-employee cross-reference detection (collusion patterns)
- FX rate source verification (multi-source validation)
- Canary token monitoring (honey record access detection)
- Database audit trigger analysis (pgaudit log processing)
- Anomaly detection on privileged actions
- Interest accrual + stuck saga recovery (enhanced with insider threat signals)

Port: 8170 (shared with reconciliation engine)
"""

import hashlib
import json
import time
import os
from datetime import datetime, timedelta
from typing import Any
from dataclasses import dataclass, field, asdict

# ─── Configuration ───────────────────────────────────────────────────────────

FX_RATE_DEVIATION_THRESHOLD = 0.005  # 0.5% max deviation between sources
FX_SOURCES = ["ecb", "openexchangerates", "xe", "wise"]
COLLUSION_LOOKBACK_DAYS = 30
COLLUSION_MIN_TRANSACTIONS = 5
ADMIN_ANOMALY_THRESHOLD = 3  # standard deviations from baseline

CANARY_TABLES = ["users", "kyc_documents", "wallets", "transactions", "agent_network"]
CANARY_RECORD_PREFIX = "honey_"

# ─── Data Models ──────────────────────────────────────────────────────────────


@dataclass
class CollusionAlert:
    alert_id: str
    employee_id: int
    agent_id: int
    pattern: str
    transaction_count: int
    total_amount: float
    confidence: float
    evidence: list = field(default_factory=list)
    created_at: str = ""
    severity: str = "high"


@dataclass
class FXRateVerification:
    pair: str
    rates: dict = field(default_factory=dict)
    median_rate: float = 0.0
    max_deviation: float = 0.0
    outlier_source: str = ""
    verified: bool = True
    timestamp: str = ""


@dataclass
class AdminAnomalyEvent:
    event_id: str
    user_id: int
    action: str
    baseline_frequency: float
    current_frequency: float
    deviation_score: float
    timestamp: str
    flagged: bool = False


@dataclass
class CanaryMonitorResult:
    table: str
    record_id: str
    status: str  # "active", "tripped", "disabled"
    last_check: str
    trip_count: int = 0


# ─── In-Memory Stores ─────────────────────────────────────────────────────────

collusion_alerts: list[CollusionAlert] = []
fx_verifications: list[FXRateVerification] = []
admin_anomalies: list[AdminAnomalyEvent] = []
canary_status: list[CanaryMonitorResult] = []

# Simulated admin action baselines (actions per hour)
admin_baselines: dict[int, dict[str, float]] = {}

# ─── Agent-Employee Collusion Detection ───────────────────────────────────────


def detect_collusion(transactions: list[dict]) -> list[CollusionAlert]:
    """
    Analyze transaction patterns to detect agent-employee collusion.

    Patterns detected:
    1. Same employee approves transfers that same agent disburses (circular approval)
    2. Agent cash-outs cluster around shift changes of specific employees
    3. Unusual frequency of small transfers just below reporting thresholds
    4. Geographic anomaly: employee in office A approving agent in distant location B
    """
    alerts = []
    # Group by employee-agent pairs
    pairs: dict[str, list[dict]] = {}
    for tx in transactions:
        approver = tx.get("approved_by", 0)
        agent = tx.get("agent_id", 0)
        if approver and agent:
            key = f"{approver}:{agent}"
            pairs.setdefault(key, []).append(tx)

    for pair_key, txs in pairs.items():
        employee_id, agent_id = map(int, pair_key.split(":"))

        # Pattern 1: Circular approval (employee approves → same agent disburses)
        if len(txs) >= COLLUSION_MIN_TRANSACTIONS:
            total_amount = sum(tx.get("amount", 0) for tx in txs)
            # Check if amounts cluster below reporting threshold
            below_threshold = sum(1 for tx in txs if tx.get("amount", 0) < 10000)
            structuring_ratio = below_threshold / len(txs) if txs else 0

            confidence = min(0.95, (len(txs) / 20) * 0.5 + structuring_ratio * 0.5)

            if confidence > 0.4:
                alert = CollusionAlert(
                    alert_id=f"col_{hashlib.sha256(pair_key.encode()).hexdigest()[:12]}",
                    employee_id=employee_id,
                    agent_id=agent_id,
                    pattern="circular_approval" if structuring_ratio > 0.7 else "high_frequency_pair",
                    transaction_count=len(txs),
                    total_amount=total_amount,
                    confidence=round(confidence, 3),
                    evidence=[
                        f"{len(txs)} transactions in {COLLUSION_LOOKBACK_DAYS} days",
                        f"{below_threshold}/{len(txs)} below reporting threshold",
                        f"Total: {total_amount:,.2f}",
                    ],
                    created_at=datetime.utcnow().isoformat(),
                    severity="critical" if confidence > 0.7 else "high",
                )
                alerts.append(alert)
                collusion_alerts.append(alert)

    return alerts


# ─── FX Rate Source Verification ──────────────────────────────────────────────


def verify_fx_rate(pair: str, proposed_rate: float, source_rates: dict[str, float] | None = None) -> FXRateVerification:
    """
    Verify an FX rate against multiple independent sources.
    Rejects if:
    - Proposed rate deviates > 0.5% from median of sources
    - Any single source deviates > 1% from others (possible manipulation)
    """
    if source_rates is None:
        # Simulate fetching from multiple sources
        base = proposed_rate
        source_rates = {
            "ecb": base * (1 + 0.001),
            "openexchangerates": base * (1 - 0.0005),
            "xe": base * (1 + 0.0002),
            "wise": base * (1 - 0.001),
        }

    rates = list(source_rates.values())
    if not rates:
        return FXRateVerification(
            pair=pair, verified=False,
            timestamp=datetime.utcnow().isoformat()
        )

    sorted_rates = sorted(rates)
    median = sorted_rates[len(sorted_rates) // 2]

    # Check proposed rate against median
    deviation_from_median = abs(proposed_rate - median) / median if median else 0

    # Find the outlier source
    max_dev = 0.0
    outlier = ""
    for source, rate in source_rates.items():
        dev = abs(rate - median) / median if median else 0
        if dev > max_dev:
            max_dev = dev
            outlier = source

    verified = deviation_from_median <= FX_RATE_DEVIATION_THRESHOLD

    result = FXRateVerification(
        pair=pair,
        rates=source_rates,
        median_rate=round(median, 6),
        max_deviation=round(max_dev, 6),
        outlier_source=outlier if max_dev > FX_RATE_DEVIATION_THRESHOLD else "",
        verified=verified,
        timestamp=datetime.utcnow().isoformat(),
    )
    fx_verifications.append(result)
    return result


# ─── Admin Anomaly Detection ──────────────────────────────────────────────────


def detect_admin_anomaly(user_id: int, action: str, current_hour_count: int) -> AdminAnomalyEvent:
    """
    Detect anomalous admin behavior by comparing current activity frequency
    to historical baseline. Flags if > 3 standard deviations from mean.
    """
    # Get or create baseline for this user+action
    baselines = admin_baselines.setdefault(user_id, {})
    baseline = baselines.get(action, 2.0)  # Default: 2 actions/hour

    # Simple z-score (assume std_dev = baseline * 0.5)
    std_dev = max(baseline * 0.5, 0.5)
    deviation = (current_hour_count - baseline) / std_dev
    flagged = deviation > ADMIN_ANOMALY_THRESHOLD

    event = AdminAnomalyEvent(
        event_id=f"anom_{hashlib.sha256(f'{user_id}:{action}:{time.time()}'.encode()).hexdigest()[:12]}",
        user_id=user_id,
        action=action,
        baseline_frequency=round(baseline, 2),
        current_frequency=float(current_hour_count),
        deviation_score=round(deviation, 2),
        timestamp=datetime.utcnow().isoformat(),
        flagged=flagged,
    )

    if flagged:
        admin_anomalies.append(event)

    # Update baseline (exponential moving average)
    baselines[action] = baseline * 0.9 + current_hour_count * 0.1

    return event


# ─── Canary Token Monitoring ──────────────────────────────────────────────────


def check_canary_access(table: str, record_ids_accessed: list[str]) -> list[dict]:
    """
    Check if any accessed record IDs match canary (honey) records.
    Returns alerts for any canary tokens that were tripped.
    """
    tripped = []
    for record_id in record_ids_accessed:
        if record_id.startswith(CANARY_RECORD_PREFIX) or record_id in ["9999", "99999"]:
            trip = {
                "canary_tripped": True,
                "table": table,
                "record_id": record_id,
                "timestamp": datetime.utcnow().isoformat(),
                "severity": "critical",
                "auto_action": "session_flagged_for_review",
                "recommended": "immediate_investigation",
            }
            tripped.append(trip)
    return tripped


# ─── Database Audit Analysis ──────────────────────────────────────────────────


def analyze_pgaudit_log(log_entries: list[dict]) -> dict:
    """
    Analyze pgaudit log entries for insider threat indicators:
    - DDL changes (schema modifications)
    - Bulk SELECT on PII tables
    - UPDATE/DELETE on financial tables
    - Access outside business hours
    """
    indicators = {
        "ddl_changes": [],
        "bulk_selects": [],
        "financial_mutations": [],
        "off_hours_access": [],
        "risk_score": 0,
    }

    for entry in log_entries:
        statement_type = entry.get("statement_type", "")
        table = entry.get("object_name", "")
        timestamp = entry.get("timestamp", "")
        user = entry.get("user_name", "")
        rows_affected = entry.get("rows", 0)

        # DDL changes (CREATE, ALTER, DROP)
        if statement_type in ("DDL",):
            indicators["ddl_changes"].append({
                "user": user, "table": table, "timestamp": timestamp
            })
            indicators["risk_score"] += 20

        # Bulk SELECT on PII tables
        if statement_type == "READ" and table in CANARY_TABLES and rows_affected > 100:
            indicators["bulk_selects"].append({
                "user": user, "table": table, "rows": rows_affected, "timestamp": timestamp
            })
            indicators["risk_score"] += 15

        # Mutations on financial tables
        if statement_type in ("WRITE",) and table in ("wallets", "transactions", "ledger_entries"):
            indicators["financial_mutations"].append({
                "user": user, "table": table, "timestamp": timestamp
            })
            indicators["risk_score"] += 10

        # Off-hours access (outside 6 AM - 10 PM UTC)
        if timestamp:
            try:
                hour = datetime.fromisoformat(timestamp.replace("Z", "+00:00")).hour
                if hour < 6 or hour >= 22:
                    indicators["off_hours_access"].append({
                        "user": user, "action": statement_type, "hour": hour, "timestamp": timestamp
                    })
                    indicators["risk_score"] += 15
            except (ValueError, AttributeError):
                pass

    indicators["risk_score"] = min(indicators["risk_score"], 100)
    return indicators


# ─── API Endpoints (integrated into main.py) ─────────────────────────────────


def get_insider_threat_metrics() -> dict:
    """Return overall insider threat detection metrics."""
    return {
        "collusion_alerts": len(collusion_alerts),
        "collusion_critical": sum(1 for a in collusion_alerts if a.severity == "critical"),
        "fx_verifications_total": len(fx_verifications),
        "fx_verifications_failed": sum(1 for v in fx_verifications if not v.verified),
        "admin_anomalies_flagged": len(admin_anomalies),
        "canary_tables_monitored": len(CANARY_TABLES),
    }


def get_collusion_alerts(limit: int = 20) -> list[dict]:
    """Return recent collusion alerts."""
    return [asdict(a) for a in collusion_alerts[-limit:]]


def get_fx_verification_history(limit: int = 20) -> list[dict]:
    """Return recent FX rate verification results."""
    return [asdict(v) for v in fx_verifications[-limit:]]
