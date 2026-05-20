"""
Wise Transfer API Endpoints
Journey: journey_12_wise
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, WiseTransfer
from app.schemas import WiseTransferRequest, UpdateWiseTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import WiseTransferWorkflow

router = APIRouter(
    prefix="/journey-12-wise",
    tags=["Wise Transfer"]
)


@router.post("/international/wise/quote")
async def wise_quote(
    request: WiseTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wise Transfer - POST /api/v1/international/wise/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            WiseTransferWorkflow,
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

@router.post("/international/wise/transfer")
async def wise_transfer(
    request: WiseTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wise Transfer - POST /api/v1/international/wise/transfer
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            WiseTransferWorkflow,
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

@router.get("/international/wise/{id}/track")
async def id_track(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Wise Transfer - GET /api/v1/international/wise/{id}/track
    """
    try:
        # Query database
        result = db.query(WiseTransfer).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

