"""
SWIFT Transfer API Endpoints
Journey: journey_11_swift
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, InternationalTransfer, ExchangeRate
from app.schemas import SWIFTTransferRequest, UpdateSWIFTTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import SWIFTTransferWorkflow

router = APIRouter(
    prefix="/journey-11-swift",
    tags=["SWIFT Transfer"]
)


@router.post("/international/swift/quote")
async def swift_quote(
    request: SWIFTTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SWIFT Transfer - POST /api/v1/international/swift/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            SWIFTTransferWorkflow,
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

@router.post("/international/swift/transfer")
async def swift_transfer(
    request: SWIFTTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SWIFT Transfer - POST /api/v1/international/swift/transfer
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            SWIFTTransferWorkflow,
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

@router.get("/international/swift/{id}/track")
async def id_track(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    SWIFT Transfer - GET /api/v1/international/swift/{id}/track
    """
    try:
        # Query database
        result = db.query(InternationalTransfer).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

