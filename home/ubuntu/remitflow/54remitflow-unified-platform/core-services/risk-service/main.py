"""
Risk Service - Fraud detection and risk scoring for transactions

Features:
- Velocity limits (transaction count/amount per time window)
- Device fingerprinting
- High-risk corridor detection
- Unusual time-of-day behavior
- Risk scoring with configurable thresholds
"""

from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import hashlib
import logging
import os
from .lakehouse_publisher import publish_risk_to_lakehouse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Risk Service",
    description="Fraud detection and risk scoring for transactions",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Enums and Constants ====================

class RiskDecision(str, Enum):
    ALLOW = "allow"
    REVIEW = "review"
    BLOCK = "block"


class RiskFactor(str, Enum):
    VELOCITY_COUNT = "velocity_count"
    VELOCITY_AMOUNT = "velocity_amount"
    NEW_DEVICE = "new_device"
    HIGH_RISK_CORRIDOR = "high_risk_corridor"
    UNUSUAL_TIME = "unusual_time"
    LARGE_AMOUNT = "large_amount"
    NEW_BENEFICIARY = "new_beneficiary"
    COUNTRY_MISMATCH = "country_mismatch"
    RAPID_SUCCESSION = "rapid_succession"


# High-risk corridors (configurable via env)
HIGH_RISK_CORRIDORS = os.getenv("HIGH_RISK_CORRIDORS", "NG-RU,NG-IR,NG-KP,NG-SY").split(",")

# Velocity limits
VELOCITY_COUNT_LIMIT_HOURLY = int(os.getenv("VELOCITY_COUNT_LIMIT_HOURLY", "5"))
VELOCITY_COUNT_LIMIT_DAILY = int(os.getenv("VELOCITY_COUNT_LIMIT_DAILY", "20"))
VELOCITY_AMOUNT_LIMIT_DAILY = float(os.getenv("VELOCITY_AMOUNT_LIMIT_DAILY", "1000000"))  # NGN

# Amount thresholds
LARGE_AMOUNT_THRESHOLD = float(os.getenv("LARGE_AMOUNT_THRESHOLD", "500000"))  # NGN

# Risk score thresholds
REVIEW_THRESHOLD = int(os.getenv("REVIEW_THRESHOLD", "50"))
BLOCK_THRESHOLD = int(os.getenv("BLOCK_THRESHOLD", "80"))


# ==================== Request/Response Models ====================

class DeviceInfo(BaseModel):
    """Device fingerprint information"""
    device_id: Optional[str] = None
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    platform: Optional[str] = None
    screen_resolution: Optional[str] = None
    timezone: Optional[str] = None
    language: Optional[str] = None


class TransactionRiskRequest(BaseModel):
    """Request to assess transaction risk"""
    user_id: str
    transaction_type: str = "transfer"
    amount: float
    source_currency: str
    destination_currency: str
    source_country: str = "NG"
    destination_country: str = "NG"
    beneficiary_id: Optional[str] = None
    is_new_beneficiary: bool = False
    device_info: Optional[DeviceInfo] = None
    timestamp: Optional[datetime] = None


class RiskFactorResult(BaseModel):
    """Individual risk factor result"""
    factor: RiskFactor
    triggered: bool
    score: int
    details: str


class RiskAssessmentResponse(BaseModel):
    """Risk assessment result"""
    request_id: str
    user_id: str
    decision: RiskDecision
    risk_score: int
    factors: List[RiskFactorResult]
    requires_additional_verification: bool = False
    recommended_actions: List[str] = []
    assessed_at: datetime


class VelocityCheckRequest(BaseModel):
    """Request to check velocity limits"""
    user_id: str
    amount: float
    currency: str = "NGN"


class VelocityCheckResponse(BaseModel):
    """Velocity check result"""
    user_id: str
    hourly_count: int
    daily_count: int
    daily_amount: float
    hourly_limit_exceeded: bool
    daily_limit_exceeded: bool
    amount_limit_exceeded: bool


# ==================== In-Memory Storage (Replace with Redis in production) ====================

# Transaction history for velocity checks
user_transactions: Dict[str, List[Dict[str, Any]]] = {}

# Known devices per user
user_devices: Dict[str, List[str]] = {}

# Risk events log
risk_events: List[Dict[str, Any]] = []


# ==================== Helper Functions ====================

def generate_device_fingerprint(device_info: DeviceInfo) -> str:
    """Generate a unique fingerprint from device info"""
    if not device_info:
        return "unknown"
    
    fingerprint_data = f"{device_info.user_agent}|{device_info.platform}|{device_info.screen_resolution}|{device_info.timezone}"
    return hashlib.sha256(fingerprint_data.encode()).hexdigest()[:16]


def get_user_transactions(user_id: str, hours: int = 24) -> List[Dict[str, Any]]:
    """Get user's recent transactions within time window"""
    if user_id not in user_transactions:
        return []
    
    cutoff = datetime.utcnow() - timedelta(hours=hours)
    return [
        t for t in user_transactions[user_id]
        if t.get("timestamp", datetime.utcnow()) > cutoff
    ]


def is_unusual_time(timestamp: datetime) -> bool:
    """Check if transaction is at unusual time (2 AM - 5 AM local)"""
    hour = timestamp.hour
    return 2 <= hour <= 5


def calculate_velocity_score(user_id: str, amount: float) -> tuple:
    """Calculate velocity-based risk score"""
    hourly_txns = get_user_transactions(user_id, hours=1)
    daily_txns = get_user_transactions(user_id, hours=24)
    
    hourly_count = len(hourly_txns)
    daily_count = len(daily_txns)
    daily_amount = sum(t.get("amount", 0) for t in daily_txns) + amount
    
    score = 0
    factors = []
    
    # Hourly count check
    if hourly_count >= VELOCITY_COUNT_LIMIT_HOURLY:
        score += 30
        factors.append(RiskFactorResult(
            factor=RiskFactor.VELOCITY_COUNT,
            triggered=True,
            score=30,
            details=f"Hourly transaction count ({hourly_count}) exceeds limit ({VELOCITY_COUNT_LIMIT_HOURLY})"
        ))
    
    # Daily count check
    if daily_count >= VELOCITY_COUNT_LIMIT_DAILY:
        score += 20
        factors.append(RiskFactorResult(
            factor=RiskFactor.VELOCITY_COUNT,
            triggered=True,
            score=20,
            details=f"Daily transaction count ({daily_count}) exceeds limit ({VELOCITY_COUNT_LIMIT_DAILY})"
        ))
    
    # Daily amount check
    if daily_amount >= VELOCITY_AMOUNT_LIMIT_DAILY:
        score += 25
        factors.append(RiskFactorResult(
            factor=RiskFactor.VELOCITY_AMOUNT,
            triggered=True,
            score=25,
            details=f"Daily transaction amount ({daily_amount:,.2f}) exceeds limit ({VELOCITY_AMOUNT_LIMIT_DAILY:,.2f})"
        ))
    
    # Rapid succession check (more than 2 transactions in last 5 minutes)
    recent_txns = get_user_transactions(user_id, hours=0.083)  # ~5 minutes
    if len(recent_txns) >= 2:
        score += 15
        factors.append(RiskFactorResult(
            factor=RiskFactor.RAPID_SUCCESSION,
            triggered=True,
            score=15,
            details=f"Multiple transactions ({len(recent_txns)}) in rapid succession"
        ))
    
    return score, factors


# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "risk-service"}


@app.post("/assess", response_model=RiskAssessmentResponse)
async def assess_transaction_risk(request: TransactionRiskRequest):
    """
    Assess the risk of a transaction and return a decision.
    
    Risk factors evaluated:
    - Velocity limits (count and amount)
    - Device fingerprinting (new device detection)
    - High-risk corridor detection
    - Unusual time-of-day behavior
    - Large amount threshold
    - New beneficiary flag
    """
    import uuid
    request_id = str(uuid.uuid4())
    timestamp = request.timestamp or datetime.utcnow()
    
    total_score = 0
    all_factors: List[RiskFactorResult] = []
    recommended_actions: List[str] = []
    
    # 1. Velocity checks
    velocity_score, velocity_factors = calculate_velocity_score(request.user_id, request.amount)
    total_score += velocity_score
    all_factors.extend(velocity_factors)
    
    # 2. Device fingerprint check
    if request.device_info:
        fingerprint = generate_device_fingerprint(request.device_info)
        known_devices = user_devices.get(request.user_id, [])
        
        if fingerprint not in known_devices and fingerprint != "unknown":
            total_score += 20
            all_factors.append(RiskFactorResult(
                factor=RiskFactor.NEW_DEVICE,
                triggered=True,
                score=20,
                details="Transaction from new/unknown device"
            ))
            recommended_actions.append("Verify device via OTP or security question")
            
            # Add device to known list
            if request.user_id not in user_devices:
                user_devices[request.user_id] = []
            user_devices[request.user_id].append(fingerprint)
    
    # 3. High-risk corridor check
    corridor = f"{request.source_country}-{request.destination_country}"
    if corridor in HIGH_RISK_CORRIDORS:
        total_score += 35
        all_factors.append(RiskFactorResult(
            factor=RiskFactor.HIGH_RISK_CORRIDOR,
            triggered=True,
            score=35,
            details=f"Transaction to high-risk corridor: {corridor}"
        ))
        recommended_actions.append("Manual compliance review required")
    
    # 4. Unusual time check
    if is_unusual_time(timestamp):
        total_score += 10
        all_factors.append(RiskFactorResult(
            factor=RiskFactor.UNUSUAL_TIME,
            triggered=True,
            score=10,
            details=f"Transaction at unusual time: {timestamp.strftime('%H:%M')}"
        ))
    
    # 5. Large amount check
    if request.amount >= LARGE_AMOUNT_THRESHOLD:
        total_score += 15
        all_factors.append(RiskFactorResult(
            factor=RiskFactor.LARGE_AMOUNT,
            triggered=True,
            score=15,
            details=f"Large transaction amount: {request.amount:,.2f} {request.source_currency}"
        ))
        recommended_actions.append("Verify source of funds")
    
    # 6. New beneficiary check
    if request.is_new_beneficiary:
        total_score += 10
        all_factors.append(RiskFactorResult(
            factor=RiskFactor.NEW_BENEFICIARY,
            triggered=True,
            score=10,
            details="First transaction to this beneficiary"
        ))
    
    # 7. Country mismatch (user's usual country vs transaction)
    # This would require user profile data - simplified here
    
    # Determine decision based on score
    if total_score >= BLOCK_THRESHOLD:
        decision = RiskDecision.BLOCK
        recommended_actions.insert(0, "Block transaction and alert user")
    elif total_score >= REVIEW_THRESHOLD:
        decision = RiskDecision.REVIEW
        recommended_actions.insert(0, "Hold for manual review")
    else:
        decision = RiskDecision.ALLOW
    
    # Record transaction for velocity tracking
    if request.user_id not in user_transactions:
        user_transactions[request.user_id] = []
    user_transactions[request.user_id].append({
        "amount": request.amount,
        "currency": request.source_currency,
        "timestamp": timestamp,
        "risk_score": total_score,
        "decision": decision
    })
    
    # Log risk event
    risk_events.append({
        "request_id": request_id,
        "user_id": request.user_id,
        "decision": decision,
        "risk_score": total_score,
        "timestamp": timestamp
    })
    
    logger.info(f"Risk assessment: user={request.user_id}, score={total_score}, decision={decision}")
    
    # Publish risk event to lakehouse for analytics (fire-and-forget)
    await publish_risk_to_lakehouse(
        request_id=request_id,
        user_id=request.user_id,
        event_type="assessment",
        risk_data={
            "decision": decision.value,
            "risk_score": total_score,
            "factors": [f.dict() for f in all_factors],
            "corridor": corridor,
            "amount": request.amount,
            "currency": request.source_currency,
            "requires_review": decision == RiskDecision.REVIEW,
            "recommended_actions": recommended_actions
        }
    )
    
    return RiskAssessmentResponse(
        request_id=request_id,
        user_id=request.user_id,
        decision=decision,
        risk_score=total_score,
        factors=all_factors,
        requires_additional_verification=decision == RiskDecision.REVIEW,
        recommended_actions=recommended_actions,
        assessed_at=datetime.utcnow()
    )


@app.post("/velocity/check", response_model=VelocityCheckResponse)
async def check_velocity(request: VelocityCheckRequest):
    """Check velocity limits for a user without recording a transaction"""
    hourly_txns = get_user_transactions(request.user_id, hours=1)
    daily_txns = get_user_transactions(request.user_id, hours=24)
    
    hourly_count = len(hourly_txns)
    daily_count = len(daily_txns)
    daily_amount = sum(t.get("amount", 0) for t in daily_txns)
    
    return VelocityCheckResponse(
        user_id=request.user_id,
        hourly_count=hourly_count,
        daily_count=daily_count,
        daily_amount=daily_amount,
        hourly_limit_exceeded=hourly_count >= VELOCITY_COUNT_LIMIT_HOURLY,
        daily_limit_exceeded=daily_count >= VELOCITY_COUNT_LIMIT_DAILY,
        amount_limit_exceeded=(daily_amount + request.amount) >= VELOCITY_AMOUNT_LIMIT_DAILY
    )


@app.get("/events/{user_id}")
async def get_risk_events(user_id: str, limit: int = 50):
    """Get risk events for a user"""
    user_events = [e for e in risk_events if e.get("user_id") == user_id]
    return {"user_id": user_id, "events": user_events[-limit:]}


@app.get("/stats")
async def get_risk_stats():
    """Get overall risk statistics"""
    total_events = len(risk_events)
    blocked = sum(1 for e in risk_events if e.get("decision") == RiskDecision.BLOCK)
    reviewed = sum(1 for e in risk_events if e.get("decision") == RiskDecision.REVIEW)
    allowed = sum(1 for e in risk_events if e.get("decision") == RiskDecision.ALLOW)
    
    return {
        "total_assessments": total_events,
        "blocked": blocked,
        "reviewed": reviewed,
        "allowed": allowed,
        "block_rate": blocked / total_events if total_events > 0 else 0,
        "review_rate": reviewed / total_events if total_events > 0 else 0
    }


@app.post("/device/register")
async def register_device(user_id: str, device_info: DeviceInfo):
    """Register a known device for a user"""
    fingerprint = generate_device_fingerprint(device_info)
    
    if user_id not in user_devices:
        user_devices[user_id] = []
    
    if fingerprint not in user_devices[user_id]:
        user_devices[user_id].append(fingerprint)
    
    return {
        "user_id": user_id,
        "device_fingerprint": fingerprint,
        "registered": True,
        "total_devices": len(user_devices[user_id])
    }


@app.get("/device/{user_id}")
async def get_user_devices(user_id: str):
    """Get registered devices for a user"""
    devices = user_devices.get(user_id, [])
    return {
        "user_id": user_id,
        "device_count": len(devices),
        "device_fingerprints": devices
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8010)
