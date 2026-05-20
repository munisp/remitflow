"""
Transaction Service
Main FastAPI application with enhanced Mojaloop and TigerBeetle integration

Features:
- Standard transfers with corridor routing
- Two-phase commit for cross-system atomicity
- Request-to-Pay (merchant-initiated payments)
- Pre-authorization holds
- Mojaloop callback handlers
- Atomic fee splits with linked transfers
- Settlement management
"""

import logging
import os
from typing import Optional, List
from decimal import Decimal
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Depends, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Import local modules
from .corridor_router import CorridorRouter, RoutingRequest, RoutingPriority, KYCTier, Corridor
from .mojaloop_callbacks import router as mojaloop_callback_router, get_callback_store
from .service import TransactionServiceService
from .database import get_db_session
from .idempotency import IdempotencyMiddleware
from .lakehouse_publisher import LakehousePublisher

# Import enhanced clients
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

try:
    from common.mojaloop_enhanced import (
        EnhancedMojaloopClient,
        get_enhanced_mojaloop_client,
        Party,
        Money,
        MojaloopError
    )
    from common.tigerbeetle_enhanced import (
        EnhancedTigerBeetleClient,
        get_enhanced_tigerbeetle_client,
        AccountFlags,
        TransferFlags,
        TransferState
    )
    from common.payment_corridor_integration import (
        PaymentCorridorIntegration,
        get_payment_corridor_integration,
        PaymentCorridor,
        TransactionMode
    )
    ENHANCED_CLIENTS_AVAILABLE = True
except ImportError:
    ENHANCED_CLIENTS_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ==================== Pydantic Models ====================

class TransferRequest(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: int = Field(..., gt=0, description="Amount in minor units")
    currency: str = "NGN"
    corridor: str = "internal"
    mode: str = "immediate"
    external_reference: Optional[str] = None
    note: Optional[str] = None
    include_fees: bool = True


class TwoPhaseTransferRequest(BaseModel):
    from_account_id: int
    to_account_id: int
    amount: int = Field(..., gt=0)
    currency: str = "NGN"
    corridor: str = "internal"
    external_reference: Optional[str] = None
    timeout_seconds: int = 300


class RequestToPayRequest(BaseModel):
    merchant_account_id: int
    merchant_msisdn: str
    customer_msisdn: str
    amount: int = Field(..., gt=0)
    currency: str = "NGN"
    invoice_id: Optional[str] = None
    note: Optional[str] = None
    expiration_seconds: int = 300


class ApprovePaymentRequest(BaseModel):
    transaction_request_id: str
    customer_account_id: int
    merchant_account_id: int
    amount: int
    currency: str = "NGN"


class PreAuthRequest(BaseModel):
    customer_account_id: int
    customer_msisdn: str
    merchant_msisdn: str
    amount: int = Field(..., gt=0)
    currency: str = "NGN"
    expiration_seconds: int = 3600


class CaptureAuthRequest(BaseModel):
    authorization_id: str
    merchant_account_id: int
    capture_amount: Optional[int] = None


class VoidAuthRequest(BaseModel):
    authorization_id: str
    reason: Optional[str] = None


class CreateAccountRequest(BaseModel):
    user_id: str
    currency: str = "NGN"
    kyc_tier: int = 1
    prevent_overdraft: bool = True


class BatchTransferRequest(BaseModel):
    transfers: List[TransferRequest]
    atomic: bool = True


class FeeSplitRequest(BaseModel):
    customer_account_id: int
    merchant_account_id: int
    fee_account_id: int
    partner_account_id: Optional[int] = None
    total_amount: int
    fee_amount: int
    partner_amount: int = 0


# ==================== Application Lifecycle ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle manager"""
    logger.info("Starting Transaction Service...")
    
    # Initialize enhanced clients if available
    if ENHANCED_CLIENTS_AVAILABLE:
        app.state.mojaloop_client = get_enhanced_mojaloop_client()
        app.state.tigerbeetle_client = get_enhanced_tigerbeetle_client()
        app.state.corridor_integration = get_payment_corridor_integration(
            mojaloop_client=app.state.mojaloop_client,
            tigerbeetle_client=app.state.tigerbeetle_client
        )
        logger.info("Enhanced Mojaloop and TigerBeetle clients initialized")
    else:
        app.state.mojaloop_client = None
        app.state.tigerbeetle_client = None
        app.state.corridor_integration = None
        logger.warning("Enhanced clients not available - running in basic mode")
    
    # Initialize other services
    app.state.transaction_service = TransactionServiceService()
    app.state.corridor_router = CorridorRouter()
    app.state.lakehouse_publisher = LakehousePublisher()
    
    yield
    
    # Cleanup
    logger.info("Shutting down Transaction Service...")
    if app.state.corridor_integration:
        await app.state.corridor_integration.close()


# ==================== FastAPI Application ====================

app = FastAPI(
    title="Transaction Service",
    description="Enhanced transaction service with Mojaloop and TigerBeetle integration",
    version="2.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Mojaloop callback routes
app.include_router(mojaloop_callback_router)


# ==================== Dependency Injection ====================

def get_corridor_integration(request) -> PaymentCorridorIntegration:
    """Get corridor integration from app state"""
    if not hasattr(request.app.state, 'corridor_integration') or not request.app.state.corridor_integration:
        raise HTTPException(status_code=503, detail="Corridor integration not available")
    return request.app.state.corridor_integration


def get_tigerbeetle_client(request) -> EnhancedTigerBeetleClient:
    """Get TigerBeetle client from app state"""
    if not hasattr(request.app.state, 'tigerbeetle_client') or not request.app.state.tigerbeetle_client:
        raise HTTPException(status_code=503, detail="TigerBeetle client not available")
    return request.app.state.tigerbeetle_client


def get_mojaloop_client(request) -> EnhancedMojaloopClient:
    """Get Mojaloop client from app state"""
    if not hasattr(request.app.state, 'mojaloop_client') or not request.app.state.mojaloop_client:
        raise HTTPException(status_code=503, detail="Mojaloop client not available")
    return request.app.state.mojaloop_client


# ==================== Health Check ====================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "transaction-service",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "features": {
            "enhanced_mojaloop": ENHANCED_CLIENTS_AVAILABLE,
            "enhanced_tigerbeetle": ENHANCED_CLIENTS_AVAILABLE,
            "two_phase_transfers": ENHANCED_CLIENTS_AVAILABLE,
            "request_to_pay": ENHANCED_CLIENTS_AVAILABLE,
            "pre_authorization": ENHANCED_CLIENTS_AVAILABLE,
            "linked_transfers": ENHANCED_CLIENTS_AVAILABLE,
            "mojaloop_callbacks": True
        }
    }


# ==================== Account Endpoints ====================

@app.post("/accounts")
async def create_account(request: CreateAccountRequest):
    """Create a user account with TigerBeetle"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    integration = app.state.corridor_integration
    result = await integration.create_user_account(
        user_id=request.user_id,
        currency=request.currency,
        kyc_tier=request.kyc_tier,
        prevent_overdraft=request.prevent_overdraft
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Account creation failed"))
    
    return result


@app.get("/accounts/{account_id}/balance")
async def get_account_balance(account_id: int, include_pending: bool = True):
    """Get account balance"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    integration = app.state.corridor_integration
    result = await integration.get_user_balance(account_id, include_pending)
    
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Account not found"))
    
    return result


# ==================== Transfer Endpoints ====================

@app.post("/transfers")
async def create_transfer(request: TransferRequest, background_tasks: BackgroundTasks):
    """
    Create a transfer through the specified corridor
    
    Supports:
    - immediate: Standard transfer
    - two_phase: Reserve then post/void
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    try:
        corridor = PaymentCorridor(request.corridor)
        mode = TransactionMode(request.mode)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid corridor or mode: {e}")
    
    result = await integration.transfer(
        from_account_id=request.from_account_id,
        to_account_id=request.to_account_id,
        amount=request.amount,
        currency=request.currency,
        corridor=corridor,
        mode=mode,
        external_reference=request.external_reference,
        note=request.note,
        include_fees=request.include_fees
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Transfer failed"))
    
    # Publish to lakehouse
    background_tasks.add_task(
        app.state.lakehouse_publisher.publish_transaction,
        result
    )
    
    return result


@app.post("/transfers/two-phase")
async def create_two_phase_transfer(request: TwoPhaseTransferRequest):
    """
    Create a two-phase transfer (reserve then post/void)
    
    This is the recommended pattern for cross-system atomicity.
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    
    result = await tb_client.create_pending_transfer(
        debit_account_id=request.from_account_id,
        credit_account_id=request.to_account_id,
        amount=request.amount,
        currency=request.currency,
        timeout_seconds=request.timeout_seconds,
        external_reference=request.external_reference
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Pending transfer failed"))
    
    return result


@app.post("/transfers/{pending_transfer_id}/post")
async def post_pending_transfer(pending_transfer_id: int, amount: Optional[int] = None):
    """Post (complete) a pending transfer"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    result = await tb_client.post_pending_transfer(pending_transfer_id, amount)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Post failed"))
    
    return result


@app.post("/transfers/{pending_transfer_id}/void")
async def void_pending_transfer(pending_transfer_id: int, reason: Optional[str] = None):
    """Void (cancel) a pending transfer"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    result = await tb_client.void_pending_transfer(pending_transfer_id, reason)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Void failed"))
    
    return result


@app.post("/transfers/linked")
async def create_linked_transfers(request: BatchTransferRequest):
    """
    Create linked (atomic) transfers
    
    All transfers succeed or fail together.
    Use for fee splits, multi-party operations, etc.
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    
    transfers = [
        {
            "debit_account_id": t.from_account_id,
            "credit_account_id": t.to_account_id,
            "amount": t.amount
        }
        for t in request.transfers
    ]
    
    result = await tb_client.create_linked_transfers(transfers)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Linked transfers failed"))
    
    return result


@app.post("/transfers/fee-split")
async def create_fee_split_transfer(request: FeeSplitRequest):
    """
    Create a fee split transfer (atomic multi-party operation)
    
    Atomically:
    - Debits customer
    - Credits merchant (minus fees)
    - Credits fee account
    - Optionally credits partner account
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    
    result = await tb_client.create_fee_split_transfer(
        customer_account_id=request.customer_account_id,
        merchant_account_id=request.merchant_account_id,
        fee_account_id=request.fee_account_id,
        partner_account_id=request.partner_account_id,
        total_amount=request.total_amount,
        fee_amount=request.fee_amount,
        partner_amount=request.partner_amount
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Fee split failed"))
    
    return result


@app.get("/transfers/{transfer_id}")
async def get_transfer(transfer_id: int):
    """Get transfer by ID"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    result = await tb_client.get_transfer(transfer_id)
    
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Transfer not found"))
    
    return result


@app.get("/transfers/by-reference/{external_reference}")
async def get_transfer_by_reference(external_reference: str):
    """Get transfer by external reference (idempotency check)"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced TigerBeetle not available")
    
    tb_client = app.state.tigerbeetle_client
    result = await tb_client.lookup_transfer_by_reference(external_reference)
    
    if not result.get("success"):
        raise HTTPException(status_code=404, detail=result.get("error", "Transfer not found"))
    
    return result


# ==================== Request-to-Pay Endpoints ====================

@app.post("/request-to-pay")
async def create_request_to_pay(request: RequestToPayRequest):
    """
    Create a Request-to-Pay (merchant-initiated payment request)
    
    The customer will receive a notification and must approve the payment.
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced Mojaloop not available")
    
    integration = app.state.corridor_integration
    
    result = await integration.request_payment(
        merchant_account_id=request.merchant_account_id,
        merchant_msisdn=request.merchant_msisdn,
        customer_msisdn=request.customer_msisdn,
        amount=request.amount,
        currency=request.currency,
        invoice_id=request.invoice_id,
        note=request.note,
        expiration_seconds=request.expiration_seconds
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Request-to-Pay failed"))
    
    return result


@app.post("/request-to-pay/approve")
async def approve_request_to_pay(request: ApprovePaymentRequest):
    """Approve a Request-to-Pay (as the customer)"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    result = await integration.approve_payment_request(
        transaction_request_id=request.transaction_request_id,
        customer_account_id=request.customer_account_id,
        merchant_account_id=request.merchant_account_id,
        amount=request.amount,
        currency=request.currency
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Approval failed"))
    
    return result


@app.post("/request-to-pay/reject")
async def reject_request_to_pay(transaction_request_id: str, reason: Optional[str] = None):
    """Reject a Request-to-Pay"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced Mojaloop not available")
    
    integration = app.state.corridor_integration
    result = await integration.reject_payment_request(transaction_request_id, reason)
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Rejection failed"))
    
    return result


# ==================== Pre-Authorization Endpoints ====================

@app.post("/authorizations")
async def create_authorization(request: PreAuthRequest):
    """
    Create a pre-authorization hold
    
    Reserves funds without completing the transfer.
    Can be captured or voided later.
    """
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    result = await integration.create_authorization(
        customer_account_id=request.customer_account_id,
        customer_msisdn=request.customer_msisdn,
        merchant_msisdn=request.merchant_msisdn,
        amount=request.amount,
        currency=request.currency,
        expiration_seconds=request.expiration_seconds
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Authorization failed"))
    
    return result


@app.post("/authorizations/capture")
async def capture_authorization(request: CaptureAuthRequest):
    """Capture an authorization (complete the pre-auth hold)"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    result = await integration.capture_authorization(
        authorization_id=request.authorization_id,
        merchant_account_id=request.merchant_account_id,
        capture_amount=request.capture_amount
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Capture failed"))
    
    return result


@app.post("/authorizations/void")
async def void_authorization(request: VoidAuthRequest):
    """Void an authorization (release the pre-auth hold)"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    result = await integration.void_authorization(
        authorization_id=request.authorization_id,
        reason=request.reason
    )
    
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Void failed"))
    
    return result


# ==================== Settlement Endpoints ====================

@app.get("/settlement/windows")
async def get_settlement_windows(state: Optional[str] = None):
    """Get Mojaloop settlement windows"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced Mojaloop not available")
    
    integration = app.state.corridor_integration
    return await integration.get_settlement_windows(state)


@app.post("/settlement/windows/{settlement_window_id}/close")
async def close_settlement_window(settlement_window_id: str, reason: Optional[str] = None):
    """Close a settlement window"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced Mojaloop not available")
    
    integration = app.state.corridor_integration
    return await integration.close_settlement_window(settlement_window_id, reason)


@app.get("/settlement/positions")
async def get_participant_positions():
    """Get participant positions for settlement"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced Mojaloop not available")
    
    integration = app.state.corridor_integration
    return await integration.get_participant_positions()


@app.post("/settlement/reconcile")
async def reconcile_settlement(
    settlement_id: str,
    corridor: str,
    expected_balance: float
):
    """Reconcile settlement between Mojaloop and TigerBeetle"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    return await integration.reconcile_settlement(
        settlement_id=settlement_id,
        corridor=corridor,
        expected_balance=Decimal(str(expected_balance))
    )


# ==================== Corridor Routing ====================

@app.post("/routing/route")
async def route_transfer(
    source_country: str,
    destination_country: str,
    source_currency: str,
    destination_currency: str,
    amount: float,
    user_kyc_tier: str = "tier_1",
    priority: str = "cost"
):
    """Get optimal corridor for a transfer"""
    router = app.state.corridor_router
    
    try:
        kyc_tier = KYCTier(user_kyc_tier)
        routing_priority = RoutingPriority(priority)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid parameter: {e}")
    
    request = RoutingRequest(
        source_country=source_country,
        destination_country=destination_country,
        source_currency=source_currency,
        destination_currency=destination_currency,
        amount=amount,
        user_kyc_tier=kyc_tier,
        priority=routing_priority
    )
    
    try:
        decision = router.route(request)
        return {
            "selected_corridor": decision.selected_corridor.value,
            "reason": decision.reason,
            "estimated_fee": decision.estimated_fee,
            "estimated_settlement_hours": decision.estimated_settlement_hours,
            "alternatives": decision.alternatives,
            "routing_metadata": decision.routing_metadata
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/routing/corridors")
async def get_eligible_corridors(
    source_country: str,
    destination_country: str,
    source_currency: str,
    destination_currency: str,
    amount: float,
    user_kyc_tier: str = "tier_1"
):
    """Get all eligible corridors for a transfer"""
    router = app.state.corridor_router
    
    try:
        kyc_tier = KYCTier(user_kyc_tier)
    except ValueError:
        kyc_tier = KYCTier.TIER_1
    
    request = RoutingRequest(
        source_country=source_country,
        destination_country=destination_country,
        source_currency=source_currency,
        destination_currency=destination_currency,
        amount=amount,
        user_kyc_tier=kyc_tier
    )
    
    eligible = router.get_eligible_corridors(request)
    return {
        "corridors": [c.corridor.value for c in eligible],
        "count": len(eligible)
    }


# ==================== Batch Operations ====================

@app.post("/batch/transfers")
async def process_batch_transfers(request: BatchTransferRequest):
    """Process multiple transfers in a batch"""
    if not ENHANCED_CLIENTS_AVAILABLE:
        raise HTTPException(status_code=503, detail="Enhanced clients not available")
    
    integration = app.state.corridor_integration
    
    transfers = [
        {
            "from_account_id": t.from_account_id,
            "to_account_id": t.to_account_id,
            "amount": t.amount,
            "currency": t.currency,
            "corridor": t.corridor,
            "mode": t.mode
        }
        for t in request.transfers
    ]
    
    result = await integration.process_bulk_transfers(transfers, request.atomic)
    
    if not result.get("success") and request.atomic:
        raise HTTPException(status_code=400, detail="Batch transfer failed")
    
    return result


# ==================== Main Entry Point ====================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8000")),
        reload=os.getenv("ENV", "development") == "development"
    )
