"""
Recurring Payment API Endpoints
Journey: journey_07_recurring_payment
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, RecurringPayment
from app.schemas import RecurringPaymentRequest, UpdateRecurringPaymentRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import RecurringPaymentWorkflow

router = APIRouter(
    prefix="/journey-07-recurring-payment",
    tags=["Recurring Payment"]
)


@router.post("/recurring/create")
async def recurring_create(
    request: RecurringPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Recurring Payment - POST /api/v1/recurring/create
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            RecurringPaymentWorkflow,
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

@router.get("/recurring/list")
async def recurring_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Recurring Payment - GET /api/v1/recurring/list
    """
    try:
        # Query database
        result = db.query(RecurringPayment).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.put("/recurring/{id}/pause")
async def id_pause(
    request: UpdateRecurringPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Recurring Payment - PUT /api/v1/recurring/{id}/pause
    """
    try:
        # Update logic
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/recurring/{id}")
async def recurring_id(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Recurring Payment - DELETE /api/v1/recurring/{id}
    """
    try:
        # Delete logic
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

