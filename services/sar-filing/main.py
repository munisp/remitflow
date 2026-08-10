"""
RemitFlow SAR Filing Service
Automated Suspicious Activity Report filing to:
  - UK: National Crime Agency (NCA) SARs Online
  - US: FinCEN BSA E-Filing
  - EU: FIU portals (via goAML where supported)

Port: 8099

REQUIRED:
  - NCA_API_KEY / NCA_API_SECRET (for UK SARs)
  - FINCEN_API_KEY / FINCEN_API_SECRET (for US BSA E-Filing)
  - JURISDICTION (GB | US | EU)
  - DATABASE_URL

FAIL-CLOSED:
  If no FIU API is configured for the jurisdiction, returns HTTP 503.
  NEVER marks a SAR as "filed" without confirmation from the FIU.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import signal
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sar_reports (
                    sar_id TEXT PRIMARY KEY,
                    transaction_id TEXT,
                    user_id TEXT,
                    jurisdiction TEXT NOT NULL,  -- GB | US | EU
                    filing_status TEXT NOT NULL DEFAULT 'draft',
                    nca_reference TEXT,
                    fincen_boid TEXT,
                    risk_score REAL,
                    risk_factors TEXT[],
                    amount_usd REAL,
                    sender_country TEXT,
                    receiver_country TEXT,
                    narrative TEXT,
                    raw_submission JSONB,
                    fiu_response JSONB,
                    error_message TEXT,
                    filed_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_sar_tx ON sar_reports(transaction_id);
                CREATE INDEX IF NOT EXISTS idx_sar_status ON sar_reports(filing_status);
                CREATE INDEX IF NOT EXISTS idx_sar_jurisdiction ON sar_reports(jurisdiction);
                CREATE TABLE IF NOT EXISTS sar_attachments (
                    attachment_id BIGSERIAL PRIMARY KEY,
                    sar_id TEXT NOT NULL REFERENCES sar_reports(sar_id),
                    file_name TEXT NOT NULL,
                    file_type TEXT NOT NULL,
                    file_data BYTEA,
                    file_hash TEXT,
                    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
            """)
    return _db_pool

def db_create_sar(sar_id, transaction_id, user_id, jurisdiction, risk_score, risk_factors, amount_usd, sender_country, receiver_country, narrative):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO sar_reports
               (sar_id, transaction_id, user_id, jurisdiction, risk_score, risk_factors, amount_usd, sender_country, receiver_country, narrative)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (sar_id, transaction_id, user_id, jurisdiction, risk_score, risk_factors, amount_usd, sender_country, receiver_country, narrative)
        )

def db_update_sar_filed(sar_id, filing_status, nca_reference=None, fincen_boid=None, fiu_response=None, error=None):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE sar_reports
               SET filing_status = %s, nca_reference = %s, fincen_boid = %s, fiu_response = %s, error_message = %s,
               filed_at = CASE WHEN %s = 'filed' THEN NOW() ELSE filed_at END,
               updated_at = NOW()
               WHERE sar_id = %s""",
            (filing_status, nca_reference, fincen_boid, psycopg2.extras.Json(fiu_response) if fiu_response else None, error, filing_status, sar_id)
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[SAR-FILING] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow SAR Filing Service",
    description="Automated Suspicious Activity Report filing to NCA, FinCEN, and EU FIUs",
    version="2.0.0",
)

_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── FIU Configuration ─────────────────────────────────────────────────────────
NCA_API_KEY = os.getenv("NCA_API_KEY", "").strip()
NCA_API_SECRET = os.getenv("NCA_API_SECRET", "").strip()
NCA_BASE_URL = os.getenv("NCA_BASE_URL", "https://api.sarsonline.nca.gov.uk/v1").strip()

FINCEN_API_KEY = os.getenv("FINCEN_API_KEY", "").strip()
FINCEN_API_SECRET = os.getenv("FINCEN_API_SECRET", "").strip()
FINCEN_BASE_URL = os.getenv("FINCEN_BASE_URL", "https://bsaefiling.fincen.gov/api/v1").strip()

DEFAULT_JURISDICTION = os.getenv("JURISDICTION", "GB").strip().upper()

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class SARCreateRequest(BaseModel):
    transaction_id: str
    user_id: str
    user_name: str
    amount_usd: float = Field(..., gt=0)
    sender_country: str = Field(..., min_length=2, max_length=2)
    receiver_country: str = Field(..., min_length=2, max_length=2)
    risk_score: float = Field(..., ge=0, le=100)
    risk_factors: List[str]
    transaction_date: str
    description: Optional[str] = None
    jurisdiction: str = Field(default=DEFAULT_JURISDICTION, pattern=r"^(GB|US|EU)$")
    narrative: Optional[str] = None

class SARFileRequest(BaseModel):
    sar_id: str
    jurisdiction: str = Field(default=DEFAULT_JURISDICTION, pattern=r"^(GB|US|EU)$")

class SARStatusResponse(BaseModel):
    sar_id: str
    filing_status: str
    jurisdiction: str
    nca_reference: Optional[str]
    fincen_boid: Optional[str]
    filed_at: Optional[str]
    created_at: str

# ─── FIU API Clients ───────────────────────────────────────────────────────────

async def _file_nca_sar(sar_id: str, req: SARCreateRequest) -> dict:
    """File SAR with UK National Crime Agency via SARs Online API."""
    if not NCA_API_KEY or not NCA_API_SECRET:
        raise HTTPException(status_code=503, detail="NCA API credentials not configured. Cannot file UK SAR.")

    narrative = req.narrative or _generate_narrative(req)

    payload = {
        "sar_reference": sar_id,
        "reporting_entity": {
            "name": "RemitFlow Financial Services Ltd",
            "fca_reference": "FCA-900001",
            "mlr_registration": "MLR-123456",
        },
        "subject": {
            "name": req.user_name,
            "user_id": req.user_id,
        },
        "suspicious_activity": {
            "transaction_id": req.transaction_id,
            "amount_gbp": round(req.amount_usd * 0.79, 2),  # approximate
            "amount_usd": req.amount_usd,
            "sender_country": req.sender_country,
            "receiver_country": req.receiver_country,
            "date": req.transaction_date,
            "risk_score": req.risk_score,
            "risk_factors": req.risk_factors,
        },
        "narrative": narrative,
        "reporting_basis": [
            "Proceeds of Crime Act 2002 (s.330)",
            "Money Laundering Regulations 2017 (r.42)",
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        auth = base64.b64encode(f"{NCA_API_KEY}:{NCA_API_SECRET}".encode()).decode()
        resp = await client.post(
            f"{NCA_BASE_URL}/sar",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

        return {
            "status": "filed",
            "nca_reference": data.get("sar_reference_number"),
            "fiu_response": data,
        }

async def _file_fincen_sar(sar_id: str, req: SARCreateRequest) -> dict:
    """File SAR with US FinCEN via BSA E-Filing API."""
    if not FINCEN_API_KEY or not FINCEN_API_SECRET:
        raise HTTPException(status_code=503, detail="FinCEN API credentials not configured. Cannot file US SAR.")

    narrative = req.narrative or _generate_narrative(req)

    payload = {
        "bsa_id": sar_id,
        "filing_type": "SAR",
        "reporting_financial_institution": {
            "name": "RemitFlow Financial Services Inc",
            "tin": "12-3456789",
            "address": "123 Finance St, New York, NY 10001",
        },
        "subject": {
            "name": req.user_name,
            "user_id": req.user_id,
        },
        "suspicious_activity": {
            "transaction_id": req.transaction_id,
            "amount": req.amount_usd,
            "currency": "USD",
            "date": req.transaction_date,
            "risk_score": req.risk_score,
            "risk_factors": req.risk_factors,
        },
        "narrative": narrative,
        "filing_basis": [
            "31 USC 5318(g)",
            "31 CFR 1022.320",
        ],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        auth = base64.b64encode(f"{FINCEN_API_KEY}:{FINCEN_API_SECRET}".encode()).decode()
        resp = await client.post(
            f"{FINCEN_BASE_URL}/bsa-filing",
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()

        return {
            "status": "filed",
            "fincen_boid": data.get("bsa_id"),
            "fiu_response": data,
        }

def _generate_narrative(req: SARCreateRequest) -> str:
    """Generate a regulatory-compliant SAR narrative."""
    factors_text = "; ".join(req.risk_factors[:5]) if req.risk_factors else "No specific risk factors identified"

    return (
        f"On {req.transaction_date}, a remittance transaction was flagged by the RemitFlow automated "
        f"compliance monitoring system with a risk score of {req.risk_score:.0f}/100. "
        f"The transaction involved ${req.amount_usd:,.2f} USD, originating from {req.sender_country} "
        f"with destination {req.receiver_country}. "
        f"Identified risk factors: {factors_text}. "
        f"This SAR is filed in accordance with applicable anti-money laundering regulations. "
        f"Additional context: {req.description or 'None provided'}."
    )

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "sar-filing",
        "version": "2.0.0",
        "fiu_integrations": {
            "nca_uk": "configured" if (NCA_API_KEY and NCA_API_SECRET) else "missing",
            "fincen_us": "configured" if (FINCEN_API_KEY and FINCEN_API_SECRET) else "missing",
        },
        "default_jurisdiction": DEFAULT_JURISDICTION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/sar/create")
async def create_sar(req: SARCreateRequest):
    """Create a SAR draft. Does NOT file to FIU yet."""
    sar_id = f"SAR-{req.jurisdiction}-{datetime.now().strftime('%Y%m%d')}-{req.transaction_id[:8].upper()}"

    narrative = req.narrative or _generate_narrative(req)

    db_create_sar(
        sar_id=sar_id,
        transaction_id=req.transaction_id,
        user_id=req.user_id,
        jurisdiction=req.jurisdiction,
        risk_score=req.risk_score,
        risk_factors=req.risk_factors,
        amount_usd=req.amount_usd,
        sender_country=req.sender_country,
        receiver_country=req.receiver_country,
        narrative=narrative,
    )

    return {
        "sar_id": sar_id,
        "status": "draft",
        "jurisdiction": req.jurisdiction,
        "narrative": narrative,
        "filing_deadline": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(),
        "next_steps": [
            "Review narrative for accuracy and completeness",
            "Attach supporting documents if available",
            "Submit via POST /sar/{sar_id}/file",
        ],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/sar/{sar_id}/file")
async def file_sar(sar_id: str, jurisdiction: str = DEFAULT_JURISDICTION):
    """File a SAR draft to the appropriate FIU."""
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT sar_id, transaction_id, user_id, risk_score, risk_factors, amount_usd, sender_country, receiver_country, narrative, jurisdiction FROM sar_reports WHERE sar_id = %s",
            (sar_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="SAR not found")

        sar_data = {
            "transaction_id": row[1],
            "user_id": row[2],
            "risk_score": row[3],
            "risk_factors": row[4],
            "amount_usd": row[5],
            "sender_country": row[6],
            "receiver_country": row[7],
            "narrative": row[8],
        }
        actual_jurisdiction = row[9] or jurisdiction

    # Create SARCreateRequest from DB data for filing
    from pydantic import TypeAdapter
    req = SARCreateRequest(
        transaction_id=sar_data["transaction_id"],
        user_id=sar_data["user_id"],
        user_name="Unknown",  # Would be fetched from user service
        amount_usd=sar_data["amount_usd"],
        sender_country=sar_data["sender_country"],
        receiver_country=sar_data["receiver_country"],
        risk_score=sar_data["risk_score"],
        risk_factors=sar_data["risk_factors"] or [],
        transaction_date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        narrative=sar_data["narrative"],
        jurisdiction=actual_jurisdiction,
    )

    try:
        if actual_jurisdiction == "GB":
            result = await _file_nca_sar(sar_id, req)
            db_update_sar_filed(sar_id, "filed", nca_reference=result["nca_reference"], fiu_response=result["fiu_response"])
            return {
                "sar_id": sar_id,
                "status": "filed",
                "jurisdiction": "GB",
                "nca_reference": result["nca_reference"],
                "filed_at": datetime.now(timezone.utc).isoformat(),
                "note": "SAR successfully filed with UK National Crime Agency.",
            }
        elif actual_jurisdiction == "US":
            result = await _file_fincen_sar(sar_id, req)
            db_update_sar_filed(sar_id, "filed", fincen_boid=result["fincen_boid"], fiu_response=result["fiu_response"])
            return {
                "sar_id": sar_id,
                "status": "filed",
                "jurisdiction": "US",
                "fincen_boid": result["fincen_boid"],
                "filed_at": datetime.now(timezone.utc).isoformat(),
                "note": "SAR successfully filed with US FinCEN.",
            }
        elif actual_jurisdiction == "EU":
            # EU filing requires goAML or direct FIU portal integration
            db_update_sar_filed(sar_id, "pending_manual_review", error="EU goAML integration not yet implemented")
            return {
                "sar_id": sar_id,
                "status": "pending_manual_review",
                "jurisdiction": "EU",
                "note": "EU SAR filing requires manual submission via goAML or national FIU portal. "
                        "The SAR draft has been prepared and is ready for manual submission.",
            }
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported jurisdiction: {actual_jurisdiction}")

    except httpx.HTTPStatusError as e:
        db_update_sar_filed(sar_id, "failed", error=f"FIU API error: {e.response.status_code} - {e.response.text}")
        raise HTTPException(
            status_code=502,
            detail=f"FIU filing failed: {e.response.status_code} - {e.response.text}",
        )
    except Exception as e:
        db_update_sar_filed(sar_id, "failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"SAR filing failed: {str(e)}")

@app.get("/sar/{sar_id}/status", response_model=SARStatusResponse)
async def get_sar_status(sar_id: str):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT sar_id, filing_status, jurisdiction, nca_reference, fincen_boid, filed_at, created_at
               FROM sar_reports WHERE sar_id = %s""",
            (sar_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="SAR not found")

        return SARStatusResponse(
            sar_id=row[0],
            filing_status=row[1],
            jurisdiction=row[2],
            nca_reference=row[3],
            fincen_boid=row[4],
            filed_at=row[5].isoformat() if row[5] else None,
            created_at=row[6].isoformat() if row[6] else None,
        )

@app.get("/sar/pending")
async def list_pending_sars(limit: int = 50):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT sar_id, transaction_id, user_id, jurisdiction, filing_status, risk_score, amount_usd, created_at
               FROM sar_reports WHERE filing_status IN ('draft', 'pending_manual_review')
               ORDER BY created_at DESC LIMIT %s""",
            (limit,)
        )
        rows = cur.fetchall()

        return [
            {
                "sar_id": r[0],
                "transaction_id": r[1],
                "user_id": r[2],
                "jurisdiction": r[3],
                "filing_status": r[4],
                "risk_score": r[5],
                "amount_usd": r[6],
                "created_at": r[7].isoformat() if r[7] else None,
            }
            for r in rows
        ]

@app.get("/sar/overdue")
async def list_overdue_sars():
    """List SARs approaching or past the 30-day filing deadline."""
    deadline = datetime.now(timezone.utc) - timedelta(days=30)
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT sar_id, transaction_id, user_id, jurisdiction, filing_status, created_at
               FROM sar_reports
               WHERE filing_status IN ('draft', 'pending_manual_review')
               AND created_at < %s
               ORDER BY created_at ASC""",
            (deadline,)
        )
        rows = cur.fetchall()

        return [
            {
                "sar_id": r[0],
                "transaction_id": r[1],
                "user_id": r[2],
                "jurisdiction": r[3],
                "filing_status": r[4],
                "created_at": r[5].isoformat() if r[5] else None,
                "days_overdue": (datetime.now(timezone.utc) - r[5]).days - 30,
            }
            for r in rows
        ]

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8099"))
    logger.info(f"Starting sar-filing v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
