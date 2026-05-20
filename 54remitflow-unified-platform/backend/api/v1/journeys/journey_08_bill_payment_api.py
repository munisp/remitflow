"""
Bill Payment API Endpoints
Journey: journey_08_bill_payment
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, BillPayment, Biller
from app.schemas import BillPaymentRequest, UpdateBillPaymentRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import BillPaymentWorkflow

router = APIRouter(
    prefix="/journey-08-bill-payment",
    tags=["Bill Payment"]
)


@router.get("/bills/billers")
async def bills_billers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bill Payment - GET /api/v1/bills/billers
    """
    try:
        # Query database
        result = db.query(BillPayment).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/bills/validate")
async def bills_validate(
    request: BillPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bill Payment - POST /api/v1/bills/validate
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            BillPaymentWorkflow,
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

@router.post("/bills/pay")
async def bills_pay(
    request: BillPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Bill Payment - POST /api/v1/bills/pay
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            BillPaymentWorkflow,
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

