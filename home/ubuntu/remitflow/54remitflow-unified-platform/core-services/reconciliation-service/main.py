"""
Reconciliation Service - Settlement reconciliation for payment corridors

Features:
- Compare transaction-service records vs TigerBeetle ledger
- Compare internal records vs corridor provider statements
- Detect and surface discrepancies
- Generate reconciliation reports
- Raise exceptions for manual resolution
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, date, timedelta
from enum import Enum
import logging
import uuid
import os
from lakehouse_publisher import publish_reconciliation_to_lakehouse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Reconciliation Service",
    description="Settlement reconciliation for payment corridors",
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

class ReconciliationStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


class DiscrepancyType(str, Enum):
    MISSING_IN_LEDGER = "missing_in_ledger"
    MISSING_IN_PROVIDER = "missing_in_provider"
    AMOUNT_MISMATCH = "amount_mismatch"
    STATUS_MISMATCH = "status_mismatch"
    DUPLICATE_TRANSACTION = "duplicate_transaction"
    CURRENCY_MISMATCH = "currency_mismatch"


class DiscrepancySeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class CorridorType(str, Enum):
    MOJALOOP = "mojaloop"
    PAPSS = "papss"
    UPI = "upi"
    PIX = "pix"
    NIBSS = "nibss"
    INTERNAL = "internal"


# ==================== Request/Response Models ====================

class ReconciliationRequest(BaseModel):
    """Request to start a reconciliation job"""
    corridor: CorridorType
    start_date: date
    end_date: date
    include_pending: bool = False


class TransactionRecord(BaseModel):
    """Internal transaction record"""
    transaction_id: str
    reference: str
    amount: float
    currency: str
    status: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    corridor: str
    metadata: Optional[Dict[str, Any]] = None


class LedgerRecord(BaseModel):
    """TigerBeetle ledger record"""
    ledger_id: str
    transaction_id: str
    debit_account: str
    credit_account: str
    amount: float
    currency: str
    timestamp: datetime
    pending: bool = False


class ProviderRecord(BaseModel):
    """External provider settlement record"""
    provider_reference: str
    internal_reference: Optional[str] = None
    amount: float
    currency: str
    status: str
    settlement_date: datetime
    provider_metadata: Optional[Dict[str, Any]] = None


class Discrepancy(BaseModel):
    """Reconciliation discrepancy"""
    id: str
    type: DiscrepancyType
    severity: DiscrepancySeverity
    transaction_id: Optional[str] = None
    internal_amount: Optional[float] = None
    external_amount: Optional[float] = None
    internal_status: Optional[str] = None
    external_status: Optional[str] = None
    description: str
    recommended_action: str
    resolved: bool = False
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    resolution_notes: Optional[str] = None


class ReconciliationReport(BaseModel):
    """Reconciliation report"""
    id: str
    corridor: CorridorType
    start_date: date
    end_date: date
    status: ReconciliationStatus
    started_at: datetime
    completed_at: Optional[datetime] = None
    
    # Counts
    total_internal_records: int = 0
    total_ledger_records: int = 0
    total_provider_records: int = 0
    matched_records: int = 0
    
    # Amounts
    total_internal_amount: float = 0.0
    total_ledger_amount: float = 0.0
    total_provider_amount: float = 0.0
    
    # Discrepancies
    discrepancies: List[Discrepancy] = []
    discrepancy_count: int = 0
    critical_discrepancies: int = 0
    
    # Summary
    reconciliation_rate: float = 0.0
    amount_variance: float = 0.0


class ResolveDiscrepancyRequest(BaseModel):
    """Request to resolve a discrepancy"""
    discrepancy_id: str
    resolution_notes: str
    resolved_by: str
    action_taken: str


# ==================== In-Memory Storage (Replace with DB in production) ====================

reconciliation_jobs: Dict[str, ReconciliationReport] = {}
all_discrepancies: Dict[str, Discrepancy] = {}

# Mock data for demonstration
mock_internal_transactions: List[TransactionRecord] = []
mock_ledger_records: List[LedgerRecord] = []
mock_provider_records: Dict[str, List[ProviderRecord]] = {}


# ==================== Helper Functions ====================

TRANSACTION_SERVICE_URL = os.getenv("TRANSACTION_SERVICE_URL", "http://transaction-service:8000")
LEDGER_SERVICE_URL = os.getenv("LEDGER_SERVICE_URL", "http://tigerbeetle-service:8000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
USE_MOCK_DATA = os.getenv("USE_MOCK_DATA", "false").lower() == "true"

# Production guard: fail fast if mock data is enabled in production
if USE_MOCK_DATA and ENVIRONMENT == "production":
    raise RuntimeError(
        "USE_MOCK_DATA=true is not allowed in production environment. "
        "Set ENVIRONMENT to 'development' or 'test' to use mock data, "
        "or set USE_MOCK_DATA=false for production."
    )


async def fetch_internal_transactions(
    corridor: CorridorType,
    start_date: date,
    end_date: date
) -> List[TransactionRecord]:
    """Fetch transactions from transaction-service"""
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{TRANSACTION_SERVICE_URL}/api/v1/transactions/",
                params={
                    "corridor": corridor.value,
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                return [
                    TransactionRecord(
                        transaction_id=t.get("id", ""),
                        reference=t.get("reference_number", ""),
                        amount=t.get("amount", 0),
                        currency=t.get("currency", "NGN"),
                        status=t.get("status", "unknown"),
                        created_at=datetime.fromisoformat(t.get("created_at", datetime.utcnow().isoformat())),
                        completed_at=datetime.fromisoformat(t["completed_at"]) if t.get("completed_at") else None,
                        corridor=t.get("corridor", corridor.value)
                    )
                    for t in data
                ]
            else:
                logger.warning(f"Failed to fetch transactions: {response.status_code}")
                return []
    except Exception as e:
        logger.error(f"Error fetching transactions: {e}")
        return []


async def fetch_ledger_records(
    transaction_ids: List[str]
) -> List[LedgerRecord]:
    """Fetch ledger entries from TigerBeetle service"""
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{LEDGER_SERVICE_URL}/api/v1/ledger/lookup",
                json={"transaction_ids": transaction_ids}
            )
            
            if response.status_code == 200:
                data = response.json()
                return [
                    LedgerRecord(
                        ledger_id=entry.get("id", ""),
                        transaction_id=entry.get("transaction_id", ""),
                        debit_account=entry.get("debit_account", ""),
                        credit_account=entry.get("credit_account", ""),
                        amount=entry.get("amount", 0),
                        currency=entry.get("currency", "NGN"),
                        timestamp=datetime.fromisoformat(entry.get("timestamp", datetime.utcnow().isoformat())),
                        pending=entry.get("pending", False)
                    )
                    for entry in data.get("entries", [])
                ]
            else:
                logger.warning(f"Failed to fetch ledger records: {response.status_code}")
                return []
    except Exception as e:
        logger.error(f"Error fetching ledger records: {e}")
        return []


async def fetch_provider_records(
    corridor: CorridorType,
    start_date: date,
    end_date: date
) -> List[ProviderRecord]:
    """Fetch settlement records from corridor provider"""
    provider_urls = {
        CorridorType.MOJALOOP: os.getenv("MOJALOOP_SETTLEMENT_URL", "http://mojaloop:8000/settlements"),
        CorridorType.PAPSS: os.getenv("PAPSS_SETTLEMENT_URL", "http://papss:8000/settlements"),
        CorridorType.UPI: os.getenv("UPI_SETTLEMENT_URL", "http://upi:8000/settlements"),
        CorridorType.PIX: os.getenv("PIX_SETTLEMENT_URL", "http://pix:8000/settlements"),
        CorridorType.NIBSS: os.getenv("NIBSS_SETTLEMENT_URL", "http://nibss:8000/settlements"),
        CorridorType.INTERNAL: None
    }
    
    provider_url = provider_urls.get(corridor)
    if not provider_url:
        logger.info(f"No provider URL configured for corridor {corridor}")
        return []
    
    import httpx
    
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.get(
                provider_url,
                params={
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat()
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                return [
                    ProviderRecord(
                        provider_reference=p.get("reference", ""),
                        internal_reference=p.get("internal_reference"),
                        amount=p.get("amount", 0),
                        currency=p.get("currency", "NGN"),
                        status=p.get("status", "unknown"),
                        settlement_date=datetime.fromisoformat(p.get("settlement_date", datetime.utcnow().isoformat()))
                    )
                    for p in data.get("settlements", [])
                ]
            else:
                logger.warning(f"Failed to fetch provider records: {response.status_code}")
                return []
    except Exception as e:
        logger.error(f"Error fetching provider records: {e}")
        return []


async def get_reconciliation_data(
    corridor: CorridorType,
    start_date: date,
    end_date: date
) -> tuple:
    """
    Get reconciliation data from real services.
    
    In production (USE_MOCK_DATA=false):
    - Fetches from transaction-service, TigerBeetle, and corridor providers
    
    In development (USE_MOCK_DATA=true):
    - Returns mock data for testing (from dev_mock_data module)
    
    Note: USE_MOCK_DATA=true is blocked in production environment by startup guard.
    """
    if USE_MOCK_DATA:
        logger.info("Using mock data for reconciliation (USE_MOCK_DATA=true, ENVIRONMENT=%s)", ENVIRONMENT)
        # Import dev-only module only when needed (not in production)
        from dev_mock_data import generate_mock_reconciliation_data
        return generate_mock_reconciliation_data(
            corridor.value, start_date, end_date,
            TransactionRecord, LedgerRecord, ProviderRecord
        )
    
    logger.info(f"Fetching real data for reconciliation: corridor={corridor}, dates={start_date} to {end_date}")
    
    internal = await fetch_internal_transactions(corridor, start_date, end_date)
    
    transaction_ids = [t.transaction_id for t in internal]
    ledger = await fetch_ledger_records(transaction_ids) if transaction_ids else []
    
    provider = await fetch_provider_records(corridor, start_date, end_date)
    
    logger.info(f"Fetched: {len(internal)} transactions, {len(ledger)} ledger entries, {len(provider)} provider records")
    
    return internal, ledger, provider


def compare_records(
    internal: List[TransactionRecord],
    ledger: List[LedgerRecord],
    provider: List[ProviderRecord]
) -> List[Discrepancy]:
    """Compare records and identify discrepancies"""
    discrepancies = []
    
    # Create lookup maps
    internal_by_id = {t.transaction_id: t for t in internal}
    ledger_by_txn = {entry.transaction_id: entry for entry in ledger}
    provider_by_ref = {p.internal_reference: p for p in provider if p.internal_reference}
    
    # Check internal vs ledger
    for txn_id, txn in internal_by_id.items():
        if txn_id not in ledger_by_txn:
            discrepancies.append(Discrepancy(
                id=str(uuid.uuid4()),
                type=DiscrepancyType.MISSING_IN_LEDGER,
                severity=DiscrepancySeverity.HIGH,
                transaction_id=txn_id,
                internal_amount=txn.amount,
                description=f"Transaction {txn_id} exists in internal records but not in ledger",
                recommended_action="Investigate missing ledger entry and create if valid"
            ))
        else:
            ledger_rec = ledger_by_txn[txn_id]
            if abs(txn.amount - ledger_rec.amount) > 0.01:
                discrepancies.append(Discrepancy(
                    id=str(uuid.uuid4()),
                    type=DiscrepancyType.AMOUNT_MISMATCH,
                    severity=DiscrepancySeverity.CRITICAL if abs(txn.amount - ledger_rec.amount) > 1000 else DiscrepancySeverity.MEDIUM,
                    transaction_id=txn_id,
                    internal_amount=txn.amount,
                    external_amount=ledger_rec.amount,
                    description=f"Amount mismatch: internal={txn.amount:.2f}, ledger={ledger_rec.amount:.2f}",
                    recommended_action="Verify correct amount and adjust ledger if needed"
                ))
    
    # Check internal vs provider
    for txn in internal:
        if txn.reference not in provider_by_ref and txn.status == "completed":
            discrepancies.append(Discrepancy(
                id=str(uuid.uuid4()),
                type=DiscrepancyType.MISSING_IN_PROVIDER,
                severity=DiscrepancySeverity.HIGH,
                transaction_id=txn.transaction_id,
                internal_amount=txn.amount,
                internal_status=txn.status,
                description=f"Completed transaction {txn.transaction_id} not found in provider settlement",
                recommended_action="Contact provider to verify settlement status"
            ))
        elif txn.reference in provider_by_ref:
            prov_rec = provider_by_ref[txn.reference]
            if abs(txn.amount - prov_rec.amount) > 0.01:
                discrepancies.append(Discrepancy(
                    id=str(uuid.uuid4()),
                    type=DiscrepancyType.AMOUNT_MISMATCH,
                    severity=DiscrepancySeverity.CRITICAL if abs(txn.amount - prov_rec.amount) > 1000 else DiscrepancySeverity.MEDIUM,
                    transaction_id=txn.transaction_id,
                    internal_amount=txn.amount,
                    external_amount=prov_rec.amount,
                    description=f"Provider amount mismatch: internal={txn.amount:.2f}, provider={prov_rec.amount:.2f}",
                    recommended_action="Reconcile with provider and adjust if needed"
                ))
    
    return discrepancies


# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "reconciliation-service"}


@app.post("/reconcile", response_model=ReconciliationReport)
async def start_reconciliation(
    request: ReconciliationRequest,
    background_tasks: BackgroundTasks
):
    """
    Start a reconciliation job for a specific corridor and date range.
    
    This compares:
    1. Internal transaction records
    2. TigerBeetle ledger entries
    3. External provider settlement statements
    """
    job_id = str(uuid.uuid4())
    
    report = ReconciliationReport(
        id=job_id,
        corridor=request.corridor,
        start_date=request.start_date,
        end_date=request.end_date,
        status=ReconciliationStatus.IN_PROGRESS,
        started_at=datetime.utcnow()
    )
    
    reconciliation_jobs[job_id] = report
    
    # Fetch reconciliation data from real services (or mock if USE_MOCK_DATA=true)
    internal, ledger, provider = await get_reconciliation_data(
        request.corridor, request.start_date, request.end_date
    )
    
    # Compare records
    discrepancies = compare_records(internal, ledger, provider)
    
    # Store discrepancies
    for d in discrepancies:
        all_discrepancies[d.id] = d
    
    # Update report
    report.total_internal_records = len(internal)
    report.total_ledger_records = len(ledger)
    report.total_provider_records = len(provider)
    report.matched_records = len(internal) - len([d for d in discrepancies if d.type == DiscrepancyType.MISSING_IN_LEDGER])
    
    report.total_internal_amount = sum(t.amount for t in internal)
    report.total_ledger_amount = sum(entry.amount for entry in ledger)
    report.total_provider_amount = sum(p.amount for p in provider)
    
    report.discrepancies = discrepancies
    report.discrepancy_count = len(discrepancies)
    report.critical_discrepancies = len([d for d in discrepancies if d.severity == DiscrepancySeverity.CRITICAL])
    
    report.reconciliation_rate = report.matched_records / report.total_internal_records if report.total_internal_records > 0 else 0
    report.amount_variance = abs(report.total_internal_amount - report.total_ledger_amount)
    
    report.status = ReconciliationStatus.COMPLETED
    report.completed_at = datetime.utcnow()
    
    logger.info(f"Reconciliation completed: {job_id}, discrepancies={len(discrepancies)}")
    
    # Publish reconciliation event to lakehouse (fire-and-forget)
    await publish_reconciliation_to_lakehouse(
        reconciliation_id=job_id,
        event_type="completed",
        recon_data={
            "corridor": request.corridor.value,
            "date": request.start_date.isoformat(),
            "total_transactions": report.total_internal_records,
            "matched_count": report.matched_records,
            "unmatched_count": report.discrepancy_count,
            "discrepancy_amount": report.amount_variance,
            "status": report.status.value,
            "settlement_amount": report.total_provider_amount
        }
    )
    
    return report


@app.get("/jobs", response_model=List[ReconciliationReport])
async def list_reconciliation_jobs(
    corridor: Optional[CorridorType] = None,
    status: Optional[ReconciliationStatus] = None,
    limit: int = 50
):
    """List reconciliation jobs with optional filters"""
    jobs = list(reconciliation_jobs.values())
    
    if corridor:
        jobs = [j for j in jobs if j.corridor == corridor]
    if status:
        jobs = [j for j in jobs if j.status == status]
    
    return sorted(jobs, key=lambda x: x.started_at, reverse=True)[:limit]


@app.get("/jobs/{job_id}", response_model=ReconciliationReport)
async def get_reconciliation_job(job_id: str):
    """Get details of a specific reconciliation job"""
    if job_id not in reconciliation_jobs:
        raise HTTPException(status_code=404, detail="Reconciliation job not found")
    return reconciliation_jobs[job_id]


@app.get("/discrepancies", response_model=List[Discrepancy])
async def list_discrepancies(
    severity: Optional[DiscrepancySeverity] = None,
    type: Optional[DiscrepancyType] = None,
    resolved: Optional[bool] = None,
    limit: int = 100
):
    """List all discrepancies with optional filters"""
    discrepancies = list(all_discrepancies.values())
    
    if severity:
        discrepancies = [d for d in discrepancies if d.severity == severity]
    if type:
        discrepancies = [d for d in discrepancies if d.type == type]
    if resolved is not None:
        discrepancies = [d for d in discrepancies if d.resolved == resolved]
    
    return discrepancies[:limit]


@app.get("/discrepancies/{discrepancy_id}", response_model=Discrepancy)
async def get_discrepancy(discrepancy_id: str):
    """Get details of a specific discrepancy"""
    if discrepancy_id not in all_discrepancies:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    return all_discrepancies[discrepancy_id]


@app.post("/discrepancies/{discrepancy_id}/resolve")
async def resolve_discrepancy(discrepancy_id: str, request: ResolveDiscrepancyRequest):
    """Resolve a discrepancy with notes"""
    if discrepancy_id not in all_discrepancies:
        raise HTTPException(status_code=404, detail="Discrepancy not found")
    
    discrepancy = all_discrepancies[discrepancy_id]
    discrepancy.resolved = True
    discrepancy.resolved_at = datetime.utcnow()
    discrepancy.resolved_by = request.resolved_by
    discrepancy.resolution_notes = f"{request.action_taken}: {request.resolution_notes}"
    
    logger.info(f"Discrepancy resolved: {discrepancy_id} by {request.resolved_by}")
    
    return {"message": "Discrepancy resolved", "discrepancy": discrepancy}


@app.get("/summary")
async def get_reconciliation_summary():
    """Get overall reconciliation summary"""
    total_jobs = len(reconciliation_jobs)
    completed_jobs = len([j for j in reconciliation_jobs.values() if j.status == ReconciliationStatus.COMPLETED])
    
    total_discrepancies = len(all_discrepancies)
    unresolved = len([d for d in all_discrepancies.values() if not d.resolved])
    critical = len([d for d in all_discrepancies.values() if d.severity == DiscrepancySeverity.CRITICAL and not d.resolved])
    
    return {
        "total_reconciliation_jobs": total_jobs,
        "completed_jobs": completed_jobs,
        "total_discrepancies": total_discrepancies,
        "unresolved_discrepancies": unresolved,
        "critical_unresolved": critical,
        "resolution_rate": (total_discrepancies - unresolved) / total_discrepancies if total_discrepancies > 0 else 1.0
    }


@app.post("/schedule/daily")
async def schedule_daily_reconciliation(corridor: CorridorType):
    """Schedule daily reconciliation for a corridor (called by cron)"""
    yesterday = date.today() - timedelta(days=1)
    
    recon_request = ReconciliationRequest(
        corridor=corridor,
        start_date=yesterday,
        end_date=yesterday
    )
    
    logger.info(f"Scheduled daily reconciliation for {corridor} on {yesterday}")
    
    return {
        "message": f"Daily reconciliation scheduled for {corridor}",
        "date": yesterday.isoformat(),
        "corridor": recon_request.corridor.value,
        "start_date": recon_request.start_date.isoformat(),
        "end_date": recon_request.end_date.isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8011)
