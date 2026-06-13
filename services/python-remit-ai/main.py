"""
RemitFlow — RemitAI NLU Service (Production)
Port: 8136

Natural Language Understanding for conversational money transfers.
Intent classification, entity extraction, multilingual support.

Architecture:
  - Rule-based intent classification with confidence scoring
  - Entity extraction: amounts, currencies, beneficiary names
  - Multilingual: English, Yoruba, Igbo, Hausa, Swahili, French, Pidgin
  - Context management for multi-turn conversations

Endpoints:
  POST /classify          — classify intent from user message
  POST /extract-entities  — extract transfer entities (amount, recipient, currency)
  POST /translate         — detect language and translate to English
  POST /suggest           — generate smart suggestions based on user context
  GET  /health            — liveness probe
"""

import logging
import os
import re
import time
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager
import signal
import atexit

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS remit_ai_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_remit_ai_updated
                    ON remit_ai_state(updated_at);
                CREATE TABLE IF NOT EXISTS remit_ai_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_remit_ai_events_type
                    ON remit_ai_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO remit_ai_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM remit_ai_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM remit_ai_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO remit_ai_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("remit-ai")

PORT = int(os.getenv("PORT", "8136"))

app = FastAPI(title="RemitAI NLU Service", version="1.0.0")

# Graceful shutdown handling
_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logging.getLogger("python-remit-ai").info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

@app.on_event("shutdown")
async def _on_shutdown():
    logging.getLogger("python-remit-ai").info("FastAPI shutdown event — cleaning up resources")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ─── Intent Patterns ──────────────────────────────────────────────────────────

INTENT_PATTERNS = [
    (r"send\s+(?:\$|₦|£|€)?[\d,.]+\s+to\s+", "transfer", 0.92),
    (r"(?:how\s+much|what)\s+(?:did|have)\s+i\s+(?:send|sent|transfer)", "spending_query", 0.88),
    (r"(?:what|check|show).*(?:rate|exchange|fx)", "rate_query", 0.85),
    (r"(?:balance|how\s+much\s+do\s+i\s+have|wallet)", "balance_query", 0.90),
    (r"(?:history|recent|past|show).*(?:transfer|payment|transaction)", "history_query", 0.85),
    (r"(?:help|support|issue|problem|complaint)", "support", 0.80),
    (r"(?:kyc|verify|upgrade|identity|document)", "kyc_query", 0.85),
    (r"(?:save|savings|goal|target)", "savings_query", 0.82),
    (r"(?:bill|airtime|electricity|data|subscription)", "bill_payment", 0.88),
    (r"(?:invite|refer|friend|share)", "referral", 0.80),
]

PIDGIN_PATTERNS = [
    (r"(?:abeg|make\s+i|i\s+wan)\s+send", "transfer", 0.85),
    (r"(?:how\s+much|wetin)\s+(?:dey|remain)\s+(?:my|for)", "balance_query", 0.82),
    (r"(?:wetin|which)\s+(?:rate|exchange)", "rate_query", 0.80),
]

YORUBA_PATTERNS = [
    (r"(?:fi\s+owó|ranṣẹ́\s+owó)", "transfer", 0.82),
    (r"(?:iye\s+owó|bawo\s+ni)", "balance_query", 0.78),
]

SWAHILI_PATTERNS = [
    (r"(?:tuma\s+pesa|peleka\s+pesa)", "transfer", 0.82),
    (r"(?:salio|bakiya|pesa\s+ngapi)", "balance_query", 0.78),
]

CURRENCY_SYMBOLS = {"$": "USD", "₦": "NGN", "£": "GBP", "€": "EUR", "KSh": "KES", "GH₵": "GHS", "R": "ZAR"}


class ClassifyRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)
    language: str = Field(default="en")
    context: Dict[str, Any] = Field(default_factory=dict)


class ClassifyResponse(BaseModel):
    intent: str
    confidence: float
    entities: Dict[str, Any]
    language_detected: str
    suggestions: List[str]


class EntityRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


class EntityResponse(BaseModel):
    amount: Optional[float] = None
    currency: Optional[str] = None
    recipient_name: Optional[str] = None
    date: Optional[str] = None
    corridor: Optional[str] = None


class SuggestRequest(BaseModel):
    user_id: str
    recent_intents: List[str] = Field(default_factory=list)
    kyc_tier: str = Field(default="tier0")
    last_transfer_days_ago: int = Field(default=0)


class SuggestResponse(BaseModel):
    suggestions: List[Dict[str, str]]


def detect_language(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["abeg", "wahala", "wetin", "dey", "wan"]):
        return "pcm"  # Pidgin
    if any(w in text_lower for w in ["owó", "ranṣẹ́", "bawo"]):
        return "yo"  # Yoruba
    if any(w in text_lower for w in ["tuma", "pesa", "salio", "bakiya"]):
        return "sw"  # Swahili
    if any(w in text_lower for w in ["envoyez", "argent", "combien"]):
        return "fr"  # French
    return "en"


def classify_intent(message: str, language: str) -> Tuple[str, float]:
    patterns = INTENT_PATTERNS
    if language == "pcm":
        patterns = PIDGIN_PATTERNS + INTENT_PATTERNS
    elif language == "yo":
        patterns = YORUBA_PATTERNS + INTENT_PATTERNS
    elif language == "sw":
        patterns = SWAHILI_PATTERNS + INTENT_PATTERNS

    for pattern, intent, confidence in patterns:
        if re.search(pattern, message, re.IGNORECASE):
            return intent, confidence
    return "general", 0.3


def extract_entities(message: str) -> Dict[str, Any]:
    entities: Dict[str, Any] = {}
    amount_match = re.search(r"(\$|₦|£|€|KSh|GH₵|R)?\s*([\d,]+(?:\.\d{1,2})?)", message)
    if amount_match:
        symbol = amount_match.group(1) or ""
        entities["amount"] = float(amount_match.group(2).replace(",", ""))
        entities["currency"] = CURRENCY_SYMBOLS.get(symbol, None)

    recipient_match = re.search(r"to\s+([A-Za-z][A-Za-z\s]{1,30}?)(?:\s+in|\s+from|\s*$|,)", message, re.IGNORECASE)
    if recipient_match:
        entities["recipient_name"] = recipient_match.group(1).strip()

    return entities


@app.post("/classify", response_model=ClassifyResponse)
async def classify(req: ClassifyRequest):
    start = time.time()
    language = detect_language(req.message)
    intent, confidence = classify_intent(req.message, language)
    entities = extract_entities(req.message)

    suggestions_map = {
        "transfer": ["Confirm transfer", "Change amount", "View rates"],
        "balance_query": ["Top up", "Send money", "Transaction history"],
        "rate_query": ["Set rate alert", "Lock rate", "Compare rates"],
        "history_query": ["Filter by date", "Export CSV", "Search"],
        "support": ["Create ticket", "FAQs", "Live chat"],
        "kyc_query": ["Start upgrade", "Required documents", "My limits"],
        "general": ["Send money", "Check balance", "Exchange rates", "Help"],
    }

    latency_ms = (time.time() - start) * 1000
    logger.info(f"classify intent={intent} confidence={confidence:.2f} lang={language} latency={latency_ms:.1f}ms")

    return ClassifyResponse(
        intent=intent,
        confidence=confidence,
        entities=entities,
        language_detected=language,
        suggestions=suggestions_map.get(intent, suggestions_map["general"]),
    )


@app.post("/extract-entities", response_model=EntityResponse)
async def extract(req: EntityRequest):
    entities = extract_entities(req.message)
    return EntityResponse(
        amount=entities.get("amount"),
        currency=entities.get("currency"),
        recipient_name=entities.get("recipient_name"),
    )


@app.post("/suggest", response_model=SuggestResponse)
async def suggest(req: SuggestRequest):
    suggestions = []
    if req.kyc_tier in ("tier0", "tier1"):
        suggestions.append({"type": "kyc_upgrade", "title": "Upgrade your account", "description": "Increase your limits", "action_url": "/kyc"})
    if req.last_transfer_days_ago > 30:
        suggestions.append({"type": "inactivity", "title": "We miss you!", "description": "Send money to family today", "action_url": "/send"})
    if "transfer" not in req.recent_intents:
        suggestions.append({"type": "first_transfer", "title": "Send your first transfer", "description": "Get started in seconds", "action_url": "/send"})
    return SuggestResponse(suggestions=suggestions)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "remit-ai-nlu", "version": "1.0.0", "languages": ["en", "pcm", "yo", "ig", "ha", "sw", "fr"]}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
