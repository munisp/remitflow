"""
Loan Application API Endpoints
Journey: journey_23_loan
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Loan, LoanApplication
from app.schemas import LoanApplicationRequest, UpdateLoanApplicationRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import LoanApplicationWorkflow

router = APIRouter(
    prefix="/journey-23-loan",
    tags=["Loan Application"]
)


@router.post("/loans/apply")
async def loans_apply(
    request: LoanApplicationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Loan Application - POST /api/v1/loans/apply
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            LoanApplicationWorkflow,
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

@router.get("/loans/{id}/status")
async def id_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Loan Application - GET /api/v1/loans/{id}/status
    """
    try:
        # Query database
        result = db.query(Loan).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/loans/{id}/accept")
async def id_accept(
    request: LoanApplicationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Loan Application - POST /api/v1/loans/{id}/accept
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            LoanApplicationWorkflow,
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

