"""
Stablecoin Transfer API Endpoints
Journey: journey_15_stablecoin
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, CryptoTransfer
from app.schemas import StablecoinTransferRequest, UpdateStablecoinTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import StablecoinTransferWorkflow

router = APIRouter(
    prefix="/journey-15-stablecoin",
    tags=["Stablecoin Transfer"]
)


@router.post("/crypto/quote")
async def crypto_quote(
    request: StablecoinTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Stablecoin Transfer - POST /api/v1/crypto/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            StablecoinTransferWorkflow,
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

@router.post("/crypto/transfer")
async def crypto_transfer(
    request: StablecoinTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Stablecoin Transfer - POST /api/v1/crypto/transfer
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            StablecoinTransferWorkflow,
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

@router.get("/crypto/{id}/track")
async def id_track(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Stablecoin Transfer - GET /api/v1/crypto/{id}/track
    """
    try:
        # Query database
        result = db.query(CryptoTransfer).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

