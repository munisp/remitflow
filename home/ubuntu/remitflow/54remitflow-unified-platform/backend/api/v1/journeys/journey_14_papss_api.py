"""
PAPSS Transfer API Endpoints
Journey: journey_14_papss
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, PAPSSTransfer
from app.schemas import PAPSSTransferRequest, UpdatePAPSSTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import PAPSSTransferWorkflow

router = APIRouter(
    prefix="/journey-14-papss",
    tags=["PAPSS Transfer"]
)


@router.post("/international/papss/quote")
async def papss_quote(
    request: PAPSSTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    PAPSS Transfer - POST /api/v1/international/papss/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            PAPSSTransferWorkflow,
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

@router.post("/international/papss/transfer")
async def papss_transfer(
    request: PAPSSTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    PAPSS Transfer - POST /api/v1/international/papss/transfer
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            PAPSSTransferWorkflow,
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

