"""
Wallet Top-up API Endpoints
Journey: journey_16_wallet_topup
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, WalletTopup
from app.schemas import WalletTop-upRequest, UpdateWalletTop-upRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import WalletTopupWorkflow

router = APIRouter(
    prefix="/journey-16-wallet-topup",
    tags=["Wallet Top-up"]
)


@router.post("/wallet/topup/initiate")
async def topup_initiate(
    request: WalletTop-upRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wallet Top-up - POST /api/v1/wallet/topup/initiate
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            WalletTopupWorkflow,
            request.dict(),
            id=workflow_id,
            task_queue="remittance-queue"
        )
        
        return {
            "success": True,
            "workflow_id": workflow_id,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/wallet/topup/verify")
async def topup_verify(
    request: WalletTop-upRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wallet Top-up - POST /api/v1/wallet/topup/verify
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            WalletTopupWorkflow,
            request.dict(),
            id=workflow_id,
            task_queue="remittance-queue"
        )
        
        return {
            "success": True,
            "workflow_id": workflow_id,
            "data": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/wallet/topup/methods")
async def topup_methods(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wallet Top-up - GET /api/v1/wallet/topup/methods
    """
    try:
        # Query database
        result = db.query(WalletTopup).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

