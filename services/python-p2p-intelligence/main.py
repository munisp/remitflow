"""
RemitFlow P2P Intelligence Service (Python)

Handles:
  - AI Fraud Detection (ML-based transaction scoring)
  - Predictive FX Alerts (rate trend analysis + notifications)
  - Social Feed generation (Venmo-style transaction summaries)
  - USSD command parser (offline P2P for feature phones)
  - Dispute resolution recommendation engine

Runs as HTTP service on port 8111.
"""

import json
import hashlib
import math
import os
import re
import statistics
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any
import signal
import atexit

PORT = int(os.getenv("P2P_INTELLIGENCE_PORT", "8111"))

# ═══════════════════════════════════════════════════════════════════════════════
# AI Fraud Detection — lightweight ML scoring without heavy dependencies
# ═══════════════════════════════════════════════════════════════════════════════

# Feature weights (trained offline, loaded here)
FRAUD_WEIGHTS = {
    "amount_zscore": 0.25,          # How unusual is this amount for this user?
    "frequency_1h": 0.20,           # Transfers in last hour
    "new_recipient": 0.15,          # Never sent to this person before
    "cross_border": 0.10,           # Cross-border = higher risk
    "high_risk_corridor": 0.15,     # Certain corridors have higher fraud rates
    "device_change": 0.10,          # Different device than usual
    "time_of_day_risk": 0.05,       # Late night transfers
}

HIGH_RISK_CORRIDORS = {"NGN-GHS", "USD-NGN", "GBP-NGN", "BRL-NGN", "NGN-ZAR"}


def score_fraud(features: dict) -> dict:
    """Score a P2P transaction for fraud risk (0.0 = safe, 1.0 = fraud)."""
    score = 0.0

    # Amount z-score (how many std devs from user's mean)
    amount_z = min(abs(features.get("amount_zscore", 0)), 5) / 5
    score += FRAUD_WEIGHTS["amount_zscore"] * amount_z

    # Transfer frequency in last hour
    freq = min(features.get("transfers_last_hour", 0), 20) / 20
    score += FRAUD_WEIGHTS["frequency_1h"] * freq

    # New recipient bonus
    if features.get("is_new_recipient", False):
        score += FRAUD_WEIGHTS["new_recipient"]

    # Cross-border bonus
    if features.get("is_cross_border", False):
        score += FRAUD_WEIGHTS["cross_border"]

    # High-risk corridor
    corridor = features.get("corridor_code", "")
    if corridor in HIGH_RISK_CORRIDORS:
        score += FRAUD_WEIGHTS["high_risk_corridor"]

    # Device change
    if features.get("device_changed", False):
        score += FRAUD_WEIGHTS["device_change"]

    # Time of day (2am-5am local time = higher risk)
    hour = features.get("local_hour", 12)
    if 2 <= hour <= 5:
        score += FRAUD_WEIGHTS["time_of_day_risk"]

    score = min(score, 1.0)

    if score >= 0.8:
        label = "critical"
        action = "block"
    elif score >= 0.6:
        label = "high"
        action = "review"
    elif score >= 0.3:
        label = "medium"
        action = "allow_with_otp"
    else:
        label = "low"
        action = "allow"

    return {
        "score": round(score, 4),
        "label": label,
        "action": action,
        "features_used": {k: round(v, 4) for k, v in {
            "amount_zscore": amount_z,
            "frequency": freq,
            "new_recipient": float(features.get("is_new_recipient", False)),
            "cross_border": float(features.get("is_cross_border", False)),
            "high_risk_corridor": float(corridor in HIGH_RISK_CORRIDORS),
        }.items()},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Predictive FX Alerts — rate trend analysis
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_fx_trend(rates: list[dict]) -> dict:
    """Analyze FX rate trend and generate alert if favorable."""
    if len(rates) < 3:
        return {"alert": False, "reason": "insufficient_data"}

    values = [r["rate"] for r in rates]
    current = values[-1]
    avg_7d = statistics.mean(values[-7:]) if len(values) >= 7 else statistics.mean(values)
    avg_30d = statistics.mean(values) if len(values) >= 14 else avg_7d

    pct_vs_7d = ((current - avg_7d) / avg_7d) * 100 if avg_7d else 0
    pct_vs_30d = ((current - avg_30d) / avg_30d) * 100 if avg_30d else 0

    # Trend direction
    recent = values[-3:]
    trend = "stable"
    if recent[-1] > recent[0] * 1.005:
        trend = "rising"
    elif recent[-1] < recent[0] * 0.995:
        trend = "falling"

    # Alert if rate is significantly better than average
    alert = abs(pct_vs_7d) >= 2.0
    alert_type = None
    message = None

    if pct_vs_7d >= 2.0:
        alert_type = "favorable_high"
        message = f"Rate is {pct_vs_7d:.1f}% above 7-day average — good time to send"
    elif pct_vs_7d <= -2.0:
        alert_type = "unfavorable_low"
        message = f"Rate is {abs(pct_vs_7d):.1f}% below 7-day average — consider waiting"

    return {
        "alert": alert,
        "alert_type": alert_type,
        "message": message,
        "current_rate": current,
        "avg_7d": round(avg_7d, 6),
        "avg_30d": round(avg_30d, 6),
        "pct_vs_7d": round(pct_vs_7d, 2),
        "pct_vs_30d": round(pct_vs_30d, 2),
        "trend": trend,
        "volatility": round(statistics.stdev(values[-7:]) if len(values) >= 7 else 0, 6),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Social Feed — Venmo-style transaction summaries (privacy-aware)
# ═══════════════════════════════════════════════════════════════════════════════

EMOJI_MAP = {
    "lunch": "🍕", "dinner": "🍽️", "coffee": "☕", "rent": "🏠",
    "taxi": "🚕", "uber": "🚗", "gift": "🎁", "birthday": "🎂",
    "thanks": "🙏", "groceries": "🛒", "bills": "💡", "school": "📚",
    "health": "🏥", "flight": "✈️", "phone": "📱",
}


def generate_social_entry(tx: dict) -> dict:
    """Generate a privacy-safe social feed entry from a P2P transaction."""
    sender = tx.get("sender_display_name", "Someone")
    receiver = tx.get("receiver_display_name", "Someone")
    amount = tx.get("amount", 0)
    currency = tx.get("currency", "NGN")
    note = tx.get("note", "")

    # Detect emoji from note
    emoji = "💸"
    note_lower = note.lower() if note else ""
    for keyword, em in EMOJI_MAP.items():
        if keyword in note_lower:
            emoji = em
            break

    # Privacy: only show note if opt-in
    show_note = tx.get("social_opt_in", False)

    return {
        "feed_id": hashlib.sha256(f"{tx.get('transfer_id', '')}:{time.time()}".encode()).hexdigest()[:16],
        "text": f"{sender} paid {receiver}" + (f" for {note}" if show_note and note else ""),
        "emoji": emoji,
        "amount_display": f"{currency} {amount:,.2f}" if tx.get("show_amount", False) else None,
        "timestamp": tx.get("timestamp", int(time.time())),
        "likes": 0,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# USSD Command Parser — offline P2P for feature phones
# ═══════════════════════════════════════════════════════════════════════════════

# Format: *347*<amount>*<phone>#  or  *347*<command>*<params>#
USSD_PATTERNS = {
    "send": re.compile(r"^\*347\*(\d+)\*(\+?\d{7,15})#$"),        # *347*amount*phone#
    "balance": re.compile(r"^\*347\*00#$"),                        # *347*00#
    "history": re.compile(r"^\*347\*01#$"),                        # *347*01#
    "request": re.compile(r"^\*347\*2\*(\d+)\*(\+?\d{7,15})#$"),  # *347*2*amount*phone#
    "pin_change": re.compile(r"^\*347\*99\*(\d{4})\*(\d{4})#$"),  # *347*99*oldpin*newpin#
}


def parse_ussd(command: str) -> dict:
    """Parse a USSD command string into structured P2P action."""
    command = command.strip()

    for action, pattern in USSD_PATTERNS.items():
        match = pattern.match(command)
        if match:
            groups = match.groups()
            if action == "send":
                return {
                    "valid": True,
                    "action": "send",
                    "amount": int(groups[0]),
                    "recipient_phone": groups[1],
                    "requires_pin": True,
                }
            elif action == "balance":
                return {"valid": True, "action": "balance"}
            elif action == "history":
                return {"valid": True, "action": "history", "limit": 5}
            elif action == "request":
                return {
                    "valid": True,
                    "action": "request_money",
                    "amount": int(groups[0]),
                    "from_phone": groups[1],
                }
            elif action == "pin_change":
                return {
                    "valid": True,
                    "action": "pin_change",
                    "old_pin_hash": hashlib.sha256(groups[0].encode()).hexdigest(),
                    "new_pin_hash": hashlib.sha256(groups[1].encode()).hexdigest(),
                }

    return {"valid": False, "error": "Unknown USSD command", "help": "*347*amount*phone# to send"}


# ═══════════════════════════════════════════════════════════════════════════════
# Dispute Resolution Recommendation
# ═══════════════════════════════════════════════════════════════════════════════

def recommend_resolution(dispute: dict) -> dict:
    """AI-assisted dispute resolution recommendation."""
    amount = dispute.get("amount", 0)
    dispute_type = dispute.get("type", "unauthorized")
    days_since = dispute.get("days_since_transfer", 0)
    sender_history = dispute.get("sender_dispute_count", 0)
    receiver_history = dispute.get("receiver_dispute_count", 0)

    # Simple rule-based recommendation (replace with ML model later)
    if dispute_type == "unauthorized" and days_since <= 2:
        action = "full_refund"
        confidence = 0.9
        reason = "Reported within 48h, likely genuine unauthorized transfer"
    elif sender_history >= 3:
        action = "reject_dispute"
        confidence = 0.7
        reason = f"Sender has {sender_history} prior disputes — potential abuse"
    elif amount < 50 and dispute_type == "wrong_amount":
        action = "auto_refund"
        confidence = 0.85
        reason = "Low amount, cost of review exceeds dispute value"
    elif receiver_history >= 5:
        action = "full_refund"
        confidence = 0.8
        reason = f"Receiver has {receiver_history} disputes against them"
    else:
        action = "manual_review"
        confidence = 0.5
        reason = "Ambiguous case — requires human review"

    return {
        "recommended_action": action,
        "confidence": confidence,
        "reason": reason,
        "escalate_to_arbiter": action == "manual_review",
        "auto_resolve": action in ("full_refund", "auto_refund", "reject_dispute"),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# HTTP Server
# ═══════════════════════════════════════════════════════════════════════════════

class P2PIntelligenceHandler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        pass  # Suppress default logging

    def _send_json(self, data: dict, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        return json.loads(body) if body else {}

    def do_POST(self) -> None:
        try:
            body = self._read_body()
        except (json.JSONDecodeError, ValueError):
            self._send_json({"error": "Invalid JSON"}, 400)
            return

        if self.path == "/fraud/score":
            self._send_json(score_fraud(body))
        elif self.path == "/fx/trend":
            self._send_json(analyze_fx_trend(body.get("rates", [])))
        elif self.path == "/social/entry":
            self._send_json(generate_social_entry(body))
        elif self.path == "/ussd/parse":
            self._send_json(parse_ussd(body.get("command", "")))
        elif self.path == "/dispute/recommend":
            self._send_json(recommend_resolution(body))
        else:
            self._send_json({"error": "Not found"}, 404)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._send_json({
                "status": "ok",
                "service": "p2p-intelligence",
                "endpoints": ["/fraud/score", "/fx/trend", "/social/entry", "/ussd/parse", "/dispute/recommend"],
                "model_version": "1.0.0",
            })
        else:
            self._send_json({"error": "Not found"}, 404)



# Graceful shutdown handling
_shutdown_flag = False
def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    print(f"[python-p2p-intelligence] Received signal {signum}, shutting down...")

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
        "service": "python-p2p-intelligence",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "pid": os.getpid(),
        **kwargs
    }
    _LIFECYCLE_LOGGER.info(_json.dumps(payload))


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), P2PIntelligenceHandler)
    print(f"[P2P Intelligence Python] Running on port {PORT}")
    print(f"[P2P Intelligence Python] Endpoints: /fraud/score, /fx/trend, /social/entry, /ussd/parse, /dispute/recommend")
    server.serve_forever()
