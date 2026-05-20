"""
Dispute Service - Chargeback and dispute lifecycle management

Features:
- Open disputes for failed/incorrect transactions
- Provisional credit handling
- Investigation workflow
- Resolution and chargeback to corridor
- Audit trail for compliance
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import logging
import uuid
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Dispute Service",
    description="Chargeback and dispute lifecycle management",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DisputeStatus(str, Enum):
    OPEN = "open"
    UNDER_INVESTIGATION = "under_investigation"
    PROVISIONAL_CREDIT_ISSUED = "provisional_credit_issued"
    RESOLVED_IN_FAVOR = "resolved_in_favor"
    RESOLVED_AGAINST = "resolved_against"
    CHARGEBACK_INITIATED = "chargeback_initiated"
    CHARGEBACK_COMPLETED = "chargeback_completed"
    CLOSED = "closed"


class DisputeReason(str, Enum):
    UNAUTHORIZED_TRANSACTION = "unauthorized_transaction"
    DUPLICATE_CHARGE = "duplicate_charge"
    AMOUNT_MISMATCH = "amount_mismatch"
    SERVICE_NOT_RECEIVED = "service_not_received"
    INCORRECT_BENEFICIARY = "incorrect_beneficiary"
    TRANSACTION_NOT_COMPLETED = "transaction_not_completed"
    FRAUD = "fraud"
    OTHER = "other"


class DisputePriority(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CreateDisputeRequest(BaseModel):
    transaction_id: str
    user_id: str
    reason: DisputeReason
    description: str
    amount_disputed: float
    currency: str = "NGN"
    supporting_documents: List[str] = []


class DisputeNote(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    author: str
    content: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_internal: bool = True


class Dispute(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transaction_id: str
    user_id: str
    reason: DisputeReason
    description: str
    amount_disputed: float
    currency: str
    status: DisputeStatus = DisputeStatus.OPEN
    priority: DisputePriority = DisputePriority.MEDIUM
    
    provisional_credit_amount: Optional[float] = None
    provisional_credit_issued_at: Optional[datetime] = None
    
    assigned_to: Optional[str] = None
    corridor: Optional[str] = None
    chargeback_reference: Optional[str] = None
    
    resolution: Optional[str] = None
    resolution_amount: Optional[float] = None
    resolved_by: Optional[str] = None
    resolved_at: Optional[datetime] = None
    
    notes: List[DisputeNote] = []
    supporting_documents: List[str] = []
    audit_trail: List[Dict[str, Any]] = []
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    sla_deadline: Optional[datetime] = None


class UpdateDisputeRequest(BaseModel):
    status: Optional[DisputeStatus] = None
    priority: Optional[DisputePriority] = None
    assigned_to: Optional[str] = None
    note: Optional[str] = None
    note_author: Optional[str] = None


class IssueProvisionalCreditRequest(BaseModel):
    amount: float
    reason: str
    issued_by: str


class ResolveDisputeRequest(BaseModel):
    resolution: str
    resolution_amount: float
    resolved_by: str
    in_favor_of_customer: bool


class InitiateChargebackRequest(BaseModel):
    corridor: str
    amount: float
    reason: str
    initiated_by: str


disputes_db: Dict[str, Dispute] = {}
user_disputes_index: Dict[str, List[str]] = {}
transaction_disputes_index: Dict[str, List[str]] = {}


def calculate_priority(reason: DisputeReason, amount: float) -> DisputePriority:
    """Calculate dispute priority based on reason and amount"""
    if reason == DisputeReason.FRAUD or reason == DisputeReason.UNAUTHORIZED_TRANSACTION:
        return DisputePriority.CRITICAL
    if amount > 500000:
        return DisputePriority.HIGH
    if amount > 100000:
        return DisputePriority.MEDIUM
    return DisputePriority.LOW


def calculate_sla_deadline(priority: DisputePriority) -> datetime:
    """Calculate SLA deadline based on priority"""
    sla_hours = {
        DisputePriority.CRITICAL: 4,
        DisputePriority.HIGH: 24,
        DisputePriority.MEDIUM: 72,
        DisputePriority.LOW: 168
    }
    return datetime.utcnow() + timedelta(hours=sla_hours[priority])


def add_audit_entry(dispute: Dispute, action: str, actor: str, details: Dict = None):
    """Add an audit trail entry"""
    dispute.audit_trail.append({
        "id": str(uuid.uuid4()),
        "action": action,
        "actor": actor,
        "details": details or {},
        "timestamp": datetime.utcnow().isoformat()
    })
    dispute.updated_at = datetime.utcnow()


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "dispute-service"}


@app.post("/disputes", response_model=Dispute)
async def create_dispute(request: CreateDisputeRequest):
    """Create a new dispute"""
    if request.transaction_id in transaction_disputes_index:
        existing = transaction_disputes_index[request.transaction_id]
        active = [d for d in existing if disputes_db[d].status not in [DisputeStatus.CLOSED, DisputeStatus.RESOLVED_AGAINST]]
        if active:
            raise HTTPException(status_code=400, detail="Active dispute already exists for this transaction")
    
    priority = calculate_priority(request.reason, request.amount_disputed)
    sla_deadline = calculate_sla_deadline(priority)
    
    dispute = Dispute(
        transaction_id=request.transaction_id,
        user_id=request.user_id,
        reason=request.reason,
        description=request.description,
        amount_disputed=request.amount_disputed,
        currency=request.currency,
        priority=priority,
        sla_deadline=sla_deadline,
        supporting_documents=request.supporting_documents
    )
    
    add_audit_entry(dispute, "dispute_created", request.user_id, {
        "reason": request.reason.value,
        "amount": request.amount_disputed
    })
    
    disputes_db[dispute.id] = dispute
    
    if request.user_id not in user_disputes_index:
        user_disputes_index[request.user_id] = []
    user_disputes_index[request.user_id].append(dispute.id)
    
    if request.transaction_id not in transaction_disputes_index:
        transaction_disputes_index[request.transaction_id] = []
    transaction_disputes_index[request.transaction_id].append(dispute.id)
    
    logger.info(f"Dispute created: {dispute.id} for transaction {request.transaction_id}")
    
    return dispute


@app.get("/disputes/{dispute_id}", response_model=Dispute)
async def get_dispute(dispute_id: str):
    """Get dispute details"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    return disputes_db[dispute_id]


@app.get("/disputes", response_model=List[Dispute])
async def list_disputes(
    status: Optional[DisputeStatus] = None,
    priority: Optional[DisputePriority] = None,
    user_id: Optional[str] = None,
    assigned_to: Optional[str] = None,
    limit: int = 50
):
    """List disputes with optional filters"""
    disputes = list(disputes_db.values())
    
    if status:
        disputes = [d for d in disputes if d.status == status]
    if priority:
        disputes = [d for d in disputes if d.priority == priority]
    if user_id:
        disputes = [d for d in disputes if d.user_id == user_id]
    if assigned_to:
        disputes = [d for d in disputes if d.assigned_to == assigned_to]
    
    return sorted(disputes, key=lambda x: x.created_at, reverse=True)[:limit]


@app.put("/disputes/{dispute_id}", response_model=Dispute)
async def update_dispute(dispute_id: str, request: UpdateDisputeRequest):
    """Update dispute status, priority, or assignment"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    dispute = disputes_db[dispute_id]
    
    if request.status:
        old_status = dispute.status
        dispute.status = request.status
        add_audit_entry(dispute, "status_changed", request.note_author or "system", {
            "old_status": old_status.value,
            "new_status": request.status.value
        })
    
    if request.priority:
        dispute.priority = request.priority
        dispute.sla_deadline = calculate_sla_deadline(request.priority)
    
    if request.assigned_to:
        dispute.assigned_to = request.assigned_to
        add_audit_entry(dispute, "assigned", request.note_author or "system", {
            "assigned_to": request.assigned_to
        })
    
    if request.note and request.note_author:
        dispute.notes.append(DisputeNote(
            author=request.note_author,
            content=request.note
        ))
    
    return dispute


@app.post("/disputes/{dispute_id}/provisional-credit", response_model=Dispute)
async def issue_provisional_credit(dispute_id: str, request: IssueProvisionalCreditRequest):
    """Issue provisional credit to customer while dispute is investigated"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    dispute = disputes_db[dispute_id]
    
    if dispute.provisional_credit_amount:
        raise HTTPException(status_code=400, detail="Provisional credit already issued")
    
    dispute.provisional_credit_amount = request.amount
    dispute.provisional_credit_issued_at = datetime.utcnow()
    dispute.status = DisputeStatus.PROVISIONAL_CREDIT_ISSUED
    
    add_audit_entry(dispute, "provisional_credit_issued", request.issued_by, {
        "amount": request.amount,
        "reason": request.reason
    })
    
    logger.info(f"Provisional credit issued for dispute {dispute_id}: {request.amount}")
    
    return dispute


@app.post("/disputes/{dispute_id}/resolve", response_model=Dispute)
async def resolve_dispute(dispute_id: str, request: ResolveDisputeRequest):
    """Resolve a dispute"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    dispute = disputes_db[dispute_id]
    
    dispute.resolution = request.resolution
    dispute.resolution_amount = request.resolution_amount
    dispute.resolved_by = request.resolved_by
    dispute.resolved_at = datetime.utcnow()
    
    if request.in_favor_of_customer:
        dispute.status = DisputeStatus.RESOLVED_IN_FAVOR
    else:
        dispute.status = DisputeStatus.RESOLVED_AGAINST
        if dispute.provisional_credit_amount:
            add_audit_entry(dispute, "provisional_credit_reversal_required", request.resolved_by, {
                "amount": dispute.provisional_credit_amount
            })
    
    add_audit_entry(dispute, "dispute_resolved", request.resolved_by, {
        "resolution": request.resolution,
        "amount": request.resolution_amount,
        "in_favor_of_customer": request.in_favor_of_customer
    })
    
    logger.info(f"Dispute resolved: {dispute_id}, in_favor={request.in_favor_of_customer}")
    
    return dispute


@app.post("/disputes/{dispute_id}/chargeback", response_model=Dispute)
async def initiate_chargeback(dispute_id: str, request: InitiateChargebackRequest):
    """Initiate chargeback to corridor provider"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    dispute = disputes_db[dispute_id]
    
    if dispute.status != DisputeStatus.RESOLVED_IN_FAVOR:
        raise HTTPException(status_code=400, detail="Dispute must be resolved in favor of customer before chargeback")
    
    dispute.corridor = request.corridor
    dispute.chargeback_reference = f"CB-{uuid.uuid4().hex[:8].upper()}"
    dispute.status = DisputeStatus.CHARGEBACK_INITIATED
    
    add_audit_entry(dispute, "chargeback_initiated", request.initiated_by, {
        "corridor": request.corridor,
        "amount": request.amount,
        "reference": dispute.chargeback_reference
    })
    
    logger.info(f"Chargeback initiated for dispute {dispute_id}: {dispute.chargeback_reference}")
    
    return dispute


@app.post("/disputes/{dispute_id}/chargeback/complete", response_model=Dispute)
async def complete_chargeback(dispute_id: str, completed_by: str, success: bool, notes: str = ""):
    """Mark chargeback as completed"""
    if dispute_id not in disputes_db:
        raise HTTPException(status_code=404, detail="Dispute not found")
    
    dispute = disputes_db[dispute_id]
    
    if dispute.status != DisputeStatus.CHARGEBACK_INITIATED:
        raise HTTPException(status_code=400, detail="Chargeback not initiated")
    
    if success:
        dispute.status = DisputeStatus.CHARGEBACK_COMPLETED
    else:
        dispute.status = DisputeStatus.CLOSED
    
    add_audit_entry(dispute, "chargeback_completed", completed_by, {
        "success": success,
        "notes": notes
    })
    
    return dispute


@app.get("/disputes/user/{user_id}", response_model=List[Dispute])
async def get_user_disputes(user_id: str):
    """Get all disputes for a user"""
    dispute_ids = user_disputes_index.get(user_id, [])
    return [disputes_db[did] for did in dispute_ids if did in disputes_db]


@app.get("/disputes/transaction/{transaction_id}", response_model=List[Dispute])
async def get_transaction_disputes(transaction_id: str):
    """Get all disputes for a transaction"""
    dispute_ids = transaction_disputes_index.get(transaction_id, [])
    return [disputes_db[did] for did in dispute_ids if did in disputes_db]


@app.get("/stats")
async def get_dispute_stats():
    """Get dispute statistics"""
    disputes = list(disputes_db.values())
    
    open_disputes = len([d for d in disputes if d.status == DisputeStatus.OPEN])
    under_investigation = len([d for d in disputes if d.status == DisputeStatus.UNDER_INVESTIGATION])
    resolved_in_favor = len([d for d in disputes if d.status == DisputeStatus.RESOLVED_IN_FAVOR])
    resolved_against = len([d for d in disputes if d.status == DisputeStatus.RESOLVED_AGAINST])
    
    sla_breached = len([d for d in disputes if d.sla_deadline and d.sla_deadline < datetime.utcnow() and d.status not in [DisputeStatus.CLOSED, DisputeStatus.RESOLVED_IN_FAVOR, DisputeStatus.RESOLVED_AGAINST]])
    
    total_disputed_amount = sum(d.amount_disputed for d in disputes)
    total_provisional_credit = sum(d.provisional_credit_amount or 0 for d in disputes)
    
    return {
        "total_disputes": len(disputes),
        "open": open_disputes,
        "under_investigation": under_investigation,
        "resolved_in_favor": resolved_in_favor,
        "resolved_against": resolved_against,
        "sla_breached": sla_breached,
        "total_disputed_amount": total_disputed_amount,
        "total_provisional_credit": total_provisional_credit,
        "resolution_rate": (resolved_in_favor + resolved_against) / len(disputes) if disputes else 0
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8012)
