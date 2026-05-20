"""
AML Monitoring Service Router - Full Production Implementation
Anti-Money Laundering transaction monitoring, SAR filing, and alert management.
"""
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks, Query
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import asyncpg
import redis
import json
import os
import logging
import uuid

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/aml", tags=["AML Monitoring"])

DATABASE_URL = os.getenv("DATABASE_URL")
REDIS_URL = os.getenv("REDIS_URL")
CTR_THRESHOLD = float(os.getenv("AML_CTR_THRESHOLD", "10000"))
SAR_THRESHOLD = float(os.getenv("AML_SAR_THRESHOLD", "5000"))
STRUCTURING_WINDOW_HOURS = int(os.getenv("AML_STRUCTURING_WINDOW_H", "24"))
STRUCTURING_COUNT_THRESHOLD = int(os.getenv("AML_STRUCTURING_COUNT", "3"))
VELOCITY_WINDOW_HOURS = int(os.getenv("AML_VELOCITY_WINDOW_H", "1"))
VELOCITY_AMOUNT_THRESHOLD = float(os.getenv("AML_VELOCITY_AMOUNT", "20000"))

HIGH_RISK_COUNTRIES = {"AF","BY","CF","CD","CU","IR","IQ","LY","ML","MM","NI","KP","RU","SO","SS","SD","SY","VE","YE","ZW"}
MONITORED_COUNTRIES = {"AL","BB","BF","CM","GI","HT","JM","JO","KE","MT","MZ","NA","NG","PH","SN","TZ","TT","UG","AE","VN"}

class RiskLevel(str, Enum):
    LOW = "low"; MEDIUM = "medium"; HIGH = "high"; CRITICAL = "critical"

class AlertType(str, Enum):
    STRUCTURING = "structuring"; RAPID_MOVEMENT = "rapid_movement"
    HIGH_RISK_COUNTRY = "high_risk_country"; UNUSUAL_PATTERN = "unusual_pattern"
    THRESHOLD_EXCEEDED = "threshold_exceeded"; PEP_TRANSACTION = "pep_transaction"
    VELOCITY_BREACH = "velocity_breach"; ROUND_AMOUNT = "round_amount"
    SANCTIONS_HIT = "sanctions_hit"

class AlertStatus(str, Enum):
    OPEN = "open"; UNDER_REVIEW = "under_review"; ESCALATED = "escalated"
    CLEARED = "cleared"; SAR_FILED = "sar_filed"; CLOSED = "closed"

class SARStatus(str, Enum):
    DRAFT = "draft"; SUBMITTED = "submitted"; ACKNOWLEDGED = "acknowledged"; CLOSED = "closed"

class TransactionMonitorRequest(BaseModel):
    transaction_id: str; user_id: str; amount: float; amount_usd: float
    currency: str = "NGN"; transaction_type: str
    counterparty_id: Optional[str] = None; counterparty_country: Optional[str] = None
    origin_country: str = "NG"; destination_country: str = "NG"
    payment_method: Optional[str] = None; metadata: Optional[Dict[str, Any]] = None

class AlertReviewRequest(BaseModel):
    reviewer_id: str; action: AlertStatus; notes: str; escalate_to_sar: bool = False

class SARFilingRequest(BaseModel):
    alert_id: str; filing_officer_id: str; suspicious_activity_description: str
    subject_user_id: str; transaction_ids: List[str]; total_amount_usd: float
    activity_start_date: datetime; activity_end_date: datetime
    law_enforcement_contacted: bool = False

def calculate_risk(amount_usd, origin, destination, tx_type, is_pep=False, is_sanctioned=False):
    if is_sanctioned:
        return 100.0, ["SANCTIONS_HIT: entity is on a sanctions list"]
    score, factors = 0.0, []
    if is_pep:
        score += 30; factors.append("PEP: politically exposed person involved")
    if amount_usd >= CTR_THRESHOLD:
        score += 25; factors.append(f"THRESHOLD: ${amount_usd:,.2f} exceeds CTR threshold")
    elif amount_usd >= SAR_THRESHOLD:
        score += 15; factors.append(f"AMOUNT: ${amount_usd:,.2f} exceeds SAR threshold")
    if amount_usd > 1000 and amount_usd % 1000 == 0:
        score += 10; factors.append(f"ROUND_AMOUNT: suspiciously round amount ${amount_usd:,.0f}")
    if origin in HIGH_RISK_COUNTRIES:
        score += 25; factors.append(f"HIGH_RISK_ORIGIN: {origin} is FATF high-risk")
    elif origin in MONITORED_COUNTRIES:
        score += 10; factors.append(f"MONITORED_ORIGIN: {origin} is FATF monitored")
    if destination in HIGH_RISK_COUNTRIES:
        score += 25; factors.append(f"HIGH_RISK_DEST: {destination} is FATF high-risk")
    elif destination in MONITORED_COUNTRIES:
        score += 10; factors.append(f"MONITORED_DEST: {destination} is FATF monitored")
    if tx_type.lower() in {"cash_deposit","crypto_purchase","wire_transfer","money_order"}:
        score += 10; factors.append(f"TX_TYPE: {tx_type} is elevated-risk type")
    return min(score, 100.0), factors

def score_to_level(score):
    if score >= 75: return RiskLevel.CRITICAL
    elif score >= 50: return RiskLevel.HIGH
    elif score >= 25: return RiskLevel.MEDIUM
    return RiskLevel.LOW

@router.post("/monitor", summary="Screen a transaction for AML risk")
async def monitor_transaction(request: TransactionMonitorRequest, background_tasks: BackgroundTasks):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        logger.error(f"AML DB connection failed: {e}")
        return {"transaction_id": request.transaction_id, "risk_score": 50.0,
                "risk_level": RiskLevel.HIGH, "alerts_raised": [], "blocked": False,
                "warning": "AML DB unavailable — manual review required"}
    try:
        is_sanctioned = is_pep = False
        try:
            r = redis.from_url(REDIS_URL, decode_responses=True)
            is_sanctioned = r.get(f"sanctions:{request.user_id}") == "1"
            is_pep = r.get(f"pep:{request.user_id}") == "1"
        except Exception:
            row = await conn.fetchrow("SELECT id FROM sanctions_list WHERE entity_id=$1 AND is_active=true", request.user_id)
            is_sanctioned = row is not None
            row = await conn.fetchrow("SELECT id FROM pep_list WHERE user_id=$1 AND is_active=true", request.user_id)
            is_pep = row is not None

        risk_score, risk_factors = calculate_risk(
            request.amount_usd, request.origin_country, request.destination_country,
            request.transaction_type, is_pep, is_sanctioned)

        # Velocity check
        window_start = datetime.utcnow() - timedelta(hours=VELOCITY_WINDOW_HOURS)
        vel = await conn.fetchrow("SELECT COALESCE(SUM(amount_usd),0) as total FROM aml_transaction_log WHERE user_id=$1 AND created_at>=$2", request.user_id, window_start)
        if vel and float(vel["total"]) + request.amount_usd >= VELOCITY_AMOUNT_THRESHOLD:
            risk_score = min(risk_score + 20, 100.0)
            risk_factors.append(f"VELOCITY: ${float(vel['total']):,.2f} moved in last {VELOCITY_WINDOW_HOURS}h")

        # Structuring check
        struct_window = datetime.utcnow() - timedelta(hours=STRUCTURING_WINDOW_HOURS)
        struct = await conn.fetchrow(
            "SELECT COUNT(*) as count FROM aml_transaction_log WHERE user_id=$1 AND created_at>=$2 AND amount_usd BETWEEN $3 AND $4",
            request.user_id, struct_window, CTR_THRESHOLD * 0.7, CTR_THRESHOLD * 0.99)
        if struct and int(struct["count"]) >= STRUCTURING_COUNT_THRESHOLD - 1:
            risk_score = min(risk_score + 25, 100.0)
            risk_factors.append(f"STRUCTURING: {int(struct['count'])+1} transactions near CTR threshold in {STRUCTURING_WINDOW_HOURS}h")

        risk_level = score_to_level(risk_score)
        blocked = is_sanctioned

        await conn.execute(
            "INSERT INTO aml_transaction_log (id,transaction_id,user_id,amount,amount_usd,currency,transaction_type,origin_country,destination_country,risk_score,risk_level,risk_factors,is_blocked,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (transaction_id) DO NOTHING",
            str(uuid.uuid4()), request.transaction_id, request.user_id, request.amount, request.amount_usd,
            request.currency, request.transaction_type, request.origin_country, request.destination_country,
            risk_score, risk_level.value, json.dumps(risk_factors), blocked, datetime.utcnow())

        alerts_raised = []
        if risk_level in (RiskLevel.HIGH, RiskLevel.CRITICAL):
            for factor in risk_factors:
                atype = AlertType.UNUSUAL_PATTERN
                if "SANCTIONS" in factor: atype = AlertType.SANCTIONS_HIT
                elif "STRUCTURING" in factor: atype = AlertType.STRUCTURING
                elif "VELOCITY" in factor: atype = AlertType.VELOCITY_BREACH
                elif "HIGH_RISK" in factor: atype = AlertType.HIGH_RISK_COUNTRY
                elif "THRESHOLD" in factor: atype = AlertType.THRESHOLD_EXCEEDED
                elif "PEP" in factor: atype = AlertType.PEP_TRANSACTION
                elif "ROUND" in factor: atype = AlertType.ROUND_AMOUNT
                aid = str(uuid.uuid4())
                await conn.execute(
                    "INSERT INTO aml_alerts (id,transaction_id,user_id,alert_type,risk_level,description,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
                    aid, request.transaction_id, request.user_id, atype.value, risk_level.value, factor, AlertStatus.OPEN.value, datetime.utcnow())
                alerts_raised.append({"alert_id": aid, "type": atype.value, "description": factor})

        return {"transaction_id": request.transaction_id, "risk_score": round(risk_score, 2),
                "risk_level": risk_level.value, "risk_factors": risk_factors,
                "alerts_raised": alerts_raised, "blocked": blocked,
                "is_pep": is_pep, "is_sanctioned": is_sanctioned,
                "screened_at": datetime.utcnow().isoformat()}
    finally:
        await conn.close()

@router.get("/alerts", summary="List AML alerts")
async def list_alerts(risk_level: Optional[RiskLevel]=None, status: Optional[AlertStatus]=None,
                      user_id: Optional[str]=None, limit: int=Query(50,le=200), offset: int=Query(0,ge=0)):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        conditions, params, idx = [], [], 1
        if risk_level: conditions.append(f"risk_level=${idx}"); params.append(risk_level.value); idx+=1
        if status: conditions.append(f"status=${idx}"); params.append(status.value); idx+=1
        if user_id: conditions.append(f"user_id=${idx}"); params.append(user_id); idx+=1
        where = "WHERE " + " AND ".join(conditions) if conditions else ""
        rows = await conn.fetch(f"SELECT id,transaction_id,user_id,alert_type,risk_level,description,status,created_at FROM aml_alerts {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}", *params, limit, offset)
        total = await conn.fetchval(f"SELECT COUNT(*) FROM aml_alerts {where}", *params)
        return {"alerts": [dict(r) for r in rows], "total": int(total or 0), "limit": limit, "offset": offset}
    finally:
        await conn.close()

@router.get("/alerts/{alert_id}", summary="Get a specific AML alert")
async def get_alert(alert_id: str):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        row = await conn.fetchrow("SELECT * FROM aml_alerts WHERE id=$1", alert_id)
        if not row: raise HTTPException(status_code=404, detail="Alert not found")
        tx = await conn.fetchrow("SELECT * FROM aml_transaction_log WHERE transaction_id=$1", row["transaction_id"])
        return {"alert": dict(row), "transaction": dict(tx) if tx else None}
    finally:
        await conn.close()

@router.patch("/alerts/{alert_id}/review", summary="Review an AML alert")
async def review_alert(alert_id: str, request: AlertReviewRequest):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        row = await conn.fetchrow("SELECT * FROM aml_alerts WHERE id=$1", alert_id)
        if not row: raise HTTPException(status_code=404, detail="Alert not found")
        if row["status"] in (AlertStatus.CLOSED.value, AlertStatus.SAR_FILED.value):
            raise HTTPException(status_code=400, detail=f"Alert is already {row['status']}")
        new_status = AlertStatus.SAR_FILED.value if request.escalate_to_sar else request.action.value
        await conn.execute("UPDATE aml_alerts SET status=$1,reviewer_id=$2,reviewer_notes=$3,updated_at=$4 WHERE id=$5",
                           new_status, request.reviewer_id, request.notes, datetime.utcnow(), alert_id)
        return {"alert_id": alert_id, "new_status": new_status, "reviewed_by": request.reviewer_id, "reviewed_at": datetime.utcnow().isoformat()}
    finally:
        await conn.close()

@router.post("/sar", summary="File a Suspicious Activity Report")
async def file_sar(request: SARFilingRequest):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        sar_id = str(uuid.uuid4())
        ref = f"SAR-{datetime.utcnow().strftime('%Y%m%d')}-{sar_id[:8].upper()}"
        await conn.execute(
            "INSERT INTO aml_sars (id,reference_number,alert_id,filing_officer_id,subject_user_id,transaction_ids,total_amount_usd,suspicious_activity_description,activity_start_date,activity_end_date,law_enforcement_contacted,status,filed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
            sar_id, ref, request.alert_id, request.filing_officer_id, request.subject_user_id,
            json.dumps(request.transaction_ids), request.total_amount_usd,
            request.suspicious_activity_description, request.activity_start_date,
            request.activity_end_date, request.law_enforcement_contacted,
            SARStatus.SUBMITTED.value, datetime.utcnow())
        await conn.execute("UPDATE aml_alerts SET status=$1,updated_at=$2 WHERE id=$3",
                           AlertStatus.SAR_FILED.value, datetime.utcnow(), request.alert_id)
        return {"sar_id": sar_id, "reference_number": ref, "status": SARStatus.SUBMITTED.value,
                "filed_at": datetime.utcnow().isoformat(), "message": f"SAR {ref} filed successfully"}
    finally:
        await conn.close()

@router.get("/sar", summary="List all filed SARs")
async def list_sars(status: Optional[SARStatus]=None, limit: int=Query(50,le=200), offset: int=Query(0,ge=0)):
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        where = f"WHERE status='{status.value}'" if status else ""
        rows = await conn.fetch(f"SELECT id,reference_number,alert_id,filing_officer_id,subject_user_id,total_amount_usd,status,filed_at FROM aml_sars {where} ORDER BY filed_at DESC LIMIT $1 OFFSET $2", limit, offset)
        return {"sars": [dict(r) for r in rows]}
    finally:
        await conn.close()

@router.get("/stats", summary="AML monitoring statistics")
async def get_aml_stats():
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
    try:
        alert_stats = await conn.fetch("SELECT risk_level,status,COUNT(*) as count FROM aml_alerts WHERE created_at>=NOW()-INTERVAL '30 days' GROUP BY risk_level,status ORDER BY risk_level")
        sar_count = await conn.fetchval("SELECT COUNT(*) FROM aml_sars WHERE status!='closed'")
        blocked = await conn.fetchval("SELECT COUNT(*) FROM aml_transaction_log WHERE is_blocked=true AND created_at>=NOW()-INTERVAL '30 days'")
        screened = await conn.fetchval("SELECT COUNT(*) FROM aml_transaction_log WHERE created_at>=NOW()-INTERVAL '30 days'")
        return {"period": "last_30_days", "total_screened": int(screened or 0), "total_blocked": int(blocked or 0),
                "active_sars": int(sar_count or 0), "alerts_by_risk_level": [dict(r) for r in alert_stats]}
    finally:
        await conn.close()

@router.get("/health", summary="AML service health check")
async def health_check():
    db_status = redis_status = "ok"
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        await conn.fetchval("SELECT 1"); await conn.close()
    except Exception as e:
        db_status = f"error: {str(e)}"
    try:
        r = redis.from_url(REDIS_URL, decode_responses=True); r.ping()
    except Exception as e:
        redis_status = f"error: {str(e)}"
    return {"status": "ok" if db_status == "ok" else "degraded", "service": "aml-monitoring",
            "database": db_status, "redis": redis_status, "timestamp": datetime.utcnow().isoformat()}
