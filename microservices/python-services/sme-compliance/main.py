"""
sme-compliance: SME trade payment compliance engine for RemitFlow
Validates Form M requirements, CBN trade limits, ECOWAS regulations,
and China/UAE/India trade corridor compliance rules.
Integrates with: Kafka (Dapr pub/sub), OpenSearch, Redis (Dapr state)
"""
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import httpx
import os
import time
import logging
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("sme-compliance")

app = FastAPI(title="sme-compliance", version="1.0.0")

DAPR_HTTP_PORT = int(os.getenv("DAPR_HTTP_PORT", "3500"))
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
PORT = int(os.getenv("PORT", "8102"))

# CBN trade payment limits
CBN_LIMITS = {
    "CN": {"single_txn_usd": 100_000, "annual_usd": 500_000, "form_m_threshold_usd": 10_000},
    "AE": {"single_txn_usd": 100_000, "annual_usd": 500_000, "form_m_threshold_usd": 10_000},
    "IN": {"single_txn_usd": 50_000,  "annual_usd": 250_000, "form_m_threshold_usd": 10_000},
    "UK": {"single_txn_usd": 100_000, "annual_usd": 1_000_000, "form_m_threshold_usd": 10_000},
    "US": {"single_txn_usd": 100_000, "annual_usd": 1_000_000, "form_m_threshold_usd": 10_000},
}

# Sanctioned entities (sample — in production, load from OFAC/UN/EU lists)
SANCTIONED_ENTITIES = {
    "BLOCKED_CORP_001", "BLOCKED_CORP_002",
}

class TradePaymentValidationRequest(BaseModel):
    user_id: int
    corridor_code: str
    amount_usd: float
    recipient_name: str
    goods_description: Optional[str] = None
    form_m_number: Optional[str] = None
    annual_used_usd: Optional[float] = 0.0

class ValidationResult(BaseModel):
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    form_m_required: bool
    sanctions_clear: bool
    cbn_limit_ok: bool
    risk_score: float
    recommended_action: str

class FormMValidationRequest(BaseModel):
    form_m_number: str
    importer_name: str
    exporter_name: str
    goods_description: str
    value_usd: float
    corridor_code: str

async def publish_event(topic: str, data: dict):
    url = f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/kafka-pubsub/{topic}"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, json=data, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"Kafka publish failed: {e}")

async def index_opensearch(index: str, doc: dict):
    url = f"{OPENSEARCH_URL}/{index}/_doc"
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(url, json=doc, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"OpenSearch index failed: {e}")

def check_sanctions(recipient_name: str) -> bool:
    """Returns True if clear (not sanctioned)."""
    name_upper = recipient_name.upper().replace(" ", "_")
    for entity in SANCTIONED_ENTITIES:
        if entity in name_upper:
            return False
    return True

def calculate_risk_score(req: TradePaymentValidationRequest) -> float:
    """Returns risk score 0-100."""
    score = 0.0
    limits = CBN_LIMITS.get(req.corridor_code, {})
    if limits:
        single_limit = limits.get("single_txn_usd", 100_000)
        if req.amount_usd > single_limit * 0.8:
            score += 30.0
        annual_limit = limits.get("annual_usd", 500_000)
        annual_used = req.annual_used_usd or 0.0
        if annual_used + req.amount_usd > annual_limit * 0.9:
            score += 25.0
    if req.corridor_code in ["CN", "AE"]:
        score += 10.0  # Higher-risk corridors
    if not req.goods_description:
        score += 15.0
    if req.amount_usd > 50_000:
        score += 10.0
    return min(score, 100.0)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "sme-compliance", "timestamp": int(time.time())}

@app.post("/validate-payment", response_model=ValidationResult)
async def validate_payment(req: TradePaymentValidationRequest):
    errors = []
    warnings = []
    limits = CBN_LIMITS.get(req.corridor_code)
    if not limits:
        raise HTTPException(status_code=400, detail=f"Corridor {req.corridor_code} not supported")

    # 1. Single transaction limit
    cbn_limit_ok = True
    if req.amount_usd > limits["single_txn_usd"]:
        errors.append(f"Amount USD {req.amount_usd:,.0f} exceeds single transaction limit of USD {limits['single_txn_usd']:,.0f}")
        cbn_limit_ok = False

    # 2. Annual limit
    annual_used = req.annual_used_usd or 0.0
    if annual_used + req.amount_usd > limits["annual_usd"]:
        errors.append(f"Transaction would exceed annual limit of USD {limits['annual_usd']:,.0f}")
        cbn_limit_ok = False
    elif annual_used + req.amount_usd > limits["annual_usd"] * 0.9:
        warnings.append(f"Approaching annual limit: {((annual_used + req.amount_usd) / limits['annual_usd'] * 100):.1f}% used")

    # 3. Form M requirement
    form_m_required = req.amount_usd >= limits["form_m_threshold_usd"]
    if form_m_required and not req.form_m_number:
        errors.append(f"Form M required for trade payments >= USD {limits['form_m_threshold_usd']:,.0f}")

    # 4. Sanctions screening
    sanctions_clear = check_sanctions(req.recipient_name)
    if not sanctions_clear:
        errors.append(f"Recipient '{req.recipient_name}' flagged in sanctions screening")

    # 5. Goods description
    if not req.goods_description:
        warnings.append("Goods description missing — required for CBN reporting")

    risk_score = calculate_risk_score(req)
    is_valid = len(errors) == 0
    recommended_action = "approve" if is_valid and risk_score < 50 else ("review" if is_valid else "reject")

    result = ValidationResult(
        is_valid=is_valid,
        errors=errors,
        warnings=warnings,
        form_m_required=form_m_required,
        sanctions_clear=sanctions_clear,
        cbn_limit_ok=cbn_limit_ok,
        risk_score=risk_score,
        recommended_action=recommended_action,
    )

    await publish_event("sme-compliance-events", {
        "event": "payment_validated",
        "user_id": req.user_id,
        "corridor": req.corridor_code,
        "amount_usd": req.amount_usd,
        "is_valid": is_valid,
        "risk_score": risk_score,
        "timestamp": datetime.utcnow().isoformat(),
    })
    await index_opensearch("sme-compliance-validations", result.dict())
    return result

@app.post("/validate-form-m")
async def validate_form_m(req: FormMValidationRequest):
    errors = []
    warnings = []
    if not req.form_m_number.startswith("FM"):
        errors.append("Form M number must start with 'FM'")
    if req.value_usd <= 0:
        errors.append("Form M value must be positive")
    if len(req.goods_description) < 10:
        warnings.append("Goods description is very brief — may be rejected by CBN")
    if req.corridor_code not in CBN_LIMITS:
        errors.append(f"Corridor {req.corridor_code} not in approved trade corridors")
    is_valid = len(errors) == 0
    return {
        "form_m_number": req.form_m_number,
        "is_valid": is_valid,
        "errors": errors,
        "warnings": warnings,
        "cbn_reference": f"CBN-FM-{int(time.time())}" if is_valid else None,
        "validated_at": datetime.utcnow().isoformat(),
    }

@app.get("/corridor-limits/{corridor_code}")
async def get_corridor_limits(corridor_code: str):
    limits = CBN_LIMITS.get(corridor_code)
    if not limits:
        raise HTTPException(status_code=404, detail=f"Corridor {corridor_code} not found")
    return {"corridor_code": corridor_code, "limits": limits}

@app.get("/corridor-limits")
async def list_corridor_limits():
    return {"corridors": CBN_LIMITS}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
