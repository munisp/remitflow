"""
RemitFlow -- PBoC (People's Bank of China) Compliance Engine

Implements China-specific regulatory reporting and AML controls for CIPS
cross-border RMB payments:

  - SAFE (State Administration of Foreign Exchange) cross-border reporting
  - PBoC Large/Suspicious Transaction Reports (LTR/STR)
  - Anti-Money Laundering Law of PRC compliance
  - CIPS participant due diligence checks
  - CNY/CNH cross-border capital flow monitoring

Regulatory thresholds:
  - CNY 50,000 cash / CNY 200,000 transfer: PBoC reporting required
  - CNY 500,000 single transfer: Enhanced due diligence
  - USD 50,000/year individual forex quota (SAFE)

Port: 8095
"""
import os
import json
import hashlib
import uuid
import logging
import signal
import http.server
import socketserver
from datetime import datetime, timezone
from typing import Any, Optional
from dataclasses import dataclass, asdict, field

# -- PostgreSQL persistence ---------------------------------------------------
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

def _require_env(name: str) -> str:
    """Return the env var or fail loudly; never fall back to well-known default credentials."""
    value = os.getenv(name)
    if not value:
        raise RuntimeError(
            f"[pboc-compliance] {name} is not set. Refusing to fall back to "
            "well-known default credentials; configure it explicitly."
        )
    return value


_DB_URL = _require_env("DATABASE_URL")

# CORS allowlist (comma-separated). Never fall back to "*": the ACAO header is
# only emitted for origins explicitly on this list.
ALLOWED_ORIGINS = {
    o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()
}
if not ALLOWED_ORIGINS:
    logging.getLogger(__name__).warning(
        "[pboc-compliance] ALLOWED_ORIGINS is not set: cross-origin requests "
        "will receive no CORS headers (same-origin only)."
    )
_db_pool = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s [PBoC] %(message)s")
logger = logging.getLogger("pboc-compliance")


def _get_db():
    global _db_pool
    if _db_pool is None:
        try:
            _db_pool = psycopg2.connect(_DB_URL)
            _db_pool.autocommit = True
            with _db_pool.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS pboc_compliance_filings (
                        id TEXT PRIMARY KEY,
                        filing_type TEXT NOT NULL,
                        transaction_ref TEXT,
                        amount NUMERIC,
                        currency TEXT DEFAULT 'CNY',
                        risk_level TEXT DEFAULT 'LOW',
                        status TEXT DEFAULT 'filed',
                        details JSONB DEFAULT '{}',
                        created_at TIMESTAMPTZ DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_pboc_filings_type
                        ON pboc_compliance_filings(filing_type, created_at);
                """)
            logger.info("Database initialized")
        except Exception as e:
            logger.warning(f"DB connection failed (in-memory fallback): {e}")
            _db_pool = None
    return _db_pool


# -- Regulatory Thresholds ----------------------------------------------------

PBOC_THRESHOLDS = {
    "LTR_CASH": 50_000,       # CNY -- Large Transaction Report (cash)
    "LTR_TRANSFER": 200_000,  # CNY -- Large Transaction Report (transfer)
    "EDD_THRESHOLD": 500_000, # CNY -- Enhanced Due Diligence
    "SAFE_ANNUAL_QUOTA": 50_000,  # USD -- Individual annual forex quota
    "STR_AUTO": 1_000_000,    # CNY -- Auto-generate STR above this
}

# SAFE purpose codes for cross-border RMB transfers
SAFE_PURPOSE_CODES = {
    "remittance": "2022",       # Personal remittance
    "trade": "1210",            # Goods trade
    "service": "2214",          # Service trade
    "investment": "3022",       # Direct investment
    "loan_repay": "4012",       # Loan repayment
    "family_support": "2023",   # Family maintenance
    "education": "2024",        # Education expenses
    "medical": "2025",          # Medical expenses
    "travel": "2027",           # Travel expenses
}

# Sanctioned/restricted entity patterns (simplified)
RESTRICTED_ENTITIES = [
    "military",
    "defense",
    "nuclear",
    "missile",
]


@dataclass
class ComplianceResult:
    filing_id: str
    filing_type: str
    status: str  # "filed", "pending_review", "blocked", "cleared"
    risk_level: str  # "LOW", "MEDIUM", "HIGH", "CRITICAL"
    flags: list = field(default_factory=list)
    required_actions: list = field(default_factory=list)
    safe_purpose_code: str = ""
    message: str = ""


@dataclass
class ScreeningRequest:
    amount: float
    currency: str = "CNY"
    sender_name: str = ""
    sender_country: str = ""
    recipient_name: str = ""
    recipient_country: str = "CN"
    purpose: str = "remittance"
    transaction_ref: str = ""
    is_cash: bool = False


def screen_transaction(req: ScreeningRequest) -> ComplianceResult:
    """Full PBoC AML/compliance screening for a CIPS transaction."""
    filing_id = f"PBOC-{uuid.uuid4().hex[:12].upper()}"
    flags = []
    actions = []
    risk_level = "LOW"

    amount_cny = req.amount
    if req.currency != "CNY":
        # Approximate conversion for non-CNY
        fx_rates = {"USD": 7.24, "EUR": 7.85, "GBP": 9.12, "CAD": 5.28,
                     "JPY": 0.048, "HKD": 0.93, "SGD": 5.38, "AUD": 4.72}
        rate = fx_rates.get(req.currency, 7.24)
        amount_cny = req.amount * rate

    # 1. Large Transaction Report (LTR)
    threshold = PBOC_THRESHOLDS["LTR_CASH"] if req.is_cash else PBOC_THRESHOLDS["LTR_TRANSFER"]
    if amount_cny >= threshold:
        flags.append("LTR_REQUIRED")
        actions.append(f"File Large Transaction Report with PBoC (>{threshold:,.0f} CNY)")
        risk_level = "MEDIUM"

    # 2. Enhanced Due Diligence
    if amount_cny >= PBOC_THRESHOLDS["EDD_THRESHOLD"]:
        flags.append("EDD_REQUIRED")
        actions.append("Enhanced Due Diligence: verify source of funds documentation")
        risk_level = "HIGH"

    # 3. Auto-STR threshold
    if amount_cny >= PBOC_THRESHOLDS["STR_AUTO"]:
        flags.append("STR_AUTO_FILED")
        actions.append("Suspicious Transaction Report auto-filed with CAMLMAC")
        risk_level = "HIGH"

    # 4. SAFE cross-border reporting
    if req.sender_country != "CN" or req.recipient_country != "CN":
        flags.append("SAFE_CROSS_BORDER")
        actions.append("SAFE cross-border payment declaration required")
        safe_code = SAFE_PURPOSE_CODES.get(req.purpose, "2022")
    else:
        safe_code = ""

    # 5. Restricted entity screening
    combined_names = f"{req.sender_name} {req.recipient_name}".lower()
    for pattern in RESTRICTED_ENTITIES:
        if pattern in combined_names:
            flags.append("RESTRICTED_ENTITY_MATCH")
            actions.append(f"Manual review: name matches restricted pattern '{pattern}'")
            risk_level = "CRITICAL"
            break

    # 6. Cross-border direction check
    if req.sender_country != "CN" and req.recipient_country == "CN":
        flags.append("INBOUND_RMB")
    elif req.sender_country == "CN" and req.recipient_country != "CN":
        flags.append("OUTBOUND_RMB")
        # China has stricter controls on outbound capital
        if amount_cny >= 100_000:
            flags.append("OUTBOUND_ENHANCED_CHECK")
            actions.append("Outbound capital flow review required by SAFE")

    filing_type = "STR" if "STR_AUTO_FILED" in flags else "LTR" if "LTR_REQUIRED" in flags else "ROUTINE"
    status = "blocked" if risk_level == "CRITICAL" else "pending_review" if risk_level == "HIGH" else "filed"

    result = ComplianceResult(
        filing_id=filing_id,
        filing_type=filing_type,
        status=status,
        risk_level=risk_level,
        flags=flags,
        required_actions=actions,
        safe_purpose_code=safe_code,
        message=f"PBoC compliance screening complete. Risk: {risk_level}. Flags: {len(flags)}.",
    )

    # Persist to DB
    db = _get_db()
    if db:
        try:
            with db.cursor() as cur:
                cur.execute(
                    """INSERT INTO pboc_compliance_filings
                       (id, filing_type, transaction_ref, amount, currency, risk_level, status, details)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                    (filing_id, filing_type, req.transaction_ref, req.amount,
                     req.currency, risk_level, status, json.dumps(asdict(result))),
                )
        except Exception as e:
            logger.error(f"DB insert failed: {e}")

    return result


def check_safe_quota(user_id: str, amount_usd: float) -> dict:
    """Check if transfer exceeds SAFE annual individual forex quota ($50K USD)."""
    quota = PBOC_THRESHOLDS["SAFE_ANNUAL_QUOTA"]
    # In production: query cumulative YTD usage from DB
    ytd_used = 0.0
    remaining = quota - ytd_used
    exceeds = (ytd_used + amount_usd) > quota
    return {
        "user_id": user_id,
        "annual_quota_usd": quota,
        "ytd_used_usd": ytd_used,
        "remaining_usd": remaining,
        "requested_usd": amount_usd,
        "exceeds_quota": exceeds,
        "message": f"SAFE quota {'EXCEEDED' if exceeds else 'OK'}: ${amount_usd:,.2f} of ${remaining:,.2f} remaining",
    }


# -- HTTP Server (stdlib, no framework dependency) ----------------------------

class PBoCHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        logger.info(format % args)

    def _cors_origin(self) -> Optional[str]:
        """Echo the request Origin only if it is on the explicit allowlist."""
        origin = self.headers.get("Origin")
        if origin and origin in ALLOWED_ORIGINS:
            return origin
        return None

    def _send_json(self, status: int, data: Any):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(json.dumps(data, default=str).encode())

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length))

    def do_OPTIONS(self):
        self.send_response(204)
        origin = self._cors_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "status": "healthy",
                "service": "pboc-compliance",
                "version": "v1.0.0",
                "capabilities": ["screen", "safe_quota", "ltr", "str"],
            })
        elif self.path == "/ready":
            self._send_json(200, {"ready": True})
        elif self.path == "/api/v1/thresholds":
            self._send_json(200, {
                "thresholds": PBOC_THRESHOLDS,
                "purpose_codes": SAFE_PURPOSE_CODES,
            })
        elif self.path.startswith("/api/v1/filings"):
            db = _get_db()
            filings = []
            if db:
                try:
                    with db.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                        cur.execute(
                            "SELECT * FROM pboc_compliance_filings ORDER BY created_at DESC LIMIT 50"
                        )
                        filings = cur.fetchall()
                except Exception as e:
                    logger.error(f"Query failed: {e}")
            self._send_json(200, {"filings": filings, "total": len(filings)})
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        body = self._read_body()

        if self.path == "/api/v1/screen":
            req = ScreeningRequest(
                amount=body.get("amount", 0),
                currency=body.get("currency", "CNY"),
                sender_name=body.get("sender_name", ""),
                sender_country=body.get("sender_country", ""),
                recipient_name=body.get("recipient_name", ""),
                recipient_country=body.get("recipient_country", "CN"),
                purpose=body.get("purpose", "remittance"),
                transaction_ref=body.get("transaction_ref", ""),
                is_cash=body.get("is_cash", False),
            )
            result = screen_transaction(req)
            status_code = 200 if result.status != "blocked" else 403
            self._send_json(status_code, asdict(result))

        elif self.path == "/api/v1/safe-quota":
            user_id = body.get("user_id", "unknown")
            amount_usd = body.get("amount_usd", 0)
            result = check_safe_quota(user_id, amount_usd)
            self._send_json(200, result)

        else:
            self._send_json(404, {"error": "Not found"})


def main():
    port = int(os.environ.get("PORT", "8095"))
    _get_db()

    server = socketserver.TCPServer(("", port), PBoCHandler)
    server.allow_reuse_address = True

    def shutdown(signum, frame):
        logger.info("Shutting down gracefully...")
        server.shutdown()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    logger.info(f"PBoC Compliance Engine listening on :{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
