"""
Savings Account API Endpoints
Journey: journey_21_savings
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, SavingsAccount, SavingsGoal
from app.schemas import SavingsAccountRequest, UpdateSavingsAccountRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import SavingsAccountWorkflow

router = APIRouter(
    prefix="/journey-21-savings",
    tags=["Savings Account"]
)


@router.post("/savings/create")
async def savings_create(
    request: SavingsAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Savings Account - POST /api/v1/savings/create
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            SavingsAccountWorkflow,
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

@router.put("/savings/{id}/auto-save")
async def id_auto_save(
    request: UpdateSavingsAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Savings Account - PUT /api/v1/savings/{id}/auto-save
    """
    try:
        # Update logic
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/savings/list")
async def savings_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Savings Account - GET /api/v1/savings/list
    """
    try:
        # Query database
        result = db.query(SavingsAccount).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/savings/{id}/details")
async def id_details(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Savings Account - GET /api/v1/savings/{id}/details
    """
    try:
        # Query database
        result = db.query(SavingsAccount).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

