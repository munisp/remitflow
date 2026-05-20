"""
Transaction Dispute API Endpoints
Journey: journey_20_dispute
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Dispute, DisputeEvidence
from app.schemas import TransactionDisputeRequest, UpdateTransactionDisputeRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import DisputeWorkflow

router = APIRouter(
    prefix="/journey-20-dispute",
    tags=["Transaction Dispute"]
)


@router.post("/disputes/create")
async def disputes_create(
    request: TransactionDisputeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transaction Dispute - POST /api/v1/disputes/create
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            DisputeWorkflow,
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

@router.post("/disputes/{id}/evidence")
async def id_evidence(
    request: TransactionDisputeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transaction Dispute - POST /api/v1/disputes/{id}/evidence
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            DisputeWorkflow,
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

@router.get("/disputes/{id}/status")
async def id_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Transaction Dispute - GET /api/v1/disputes/{id}/status
    """
    try:
        # Query database
        result = db.query(Dispute).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

