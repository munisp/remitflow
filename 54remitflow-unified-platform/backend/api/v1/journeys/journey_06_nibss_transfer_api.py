"""
NIBSS Transfer API Endpoints
Journey: journey_06_nibss_transfer
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Transaction, TransferRequest
from app.schemas import NIBSSTransferRequest, UpdateNIBSSTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import NIBSSTransferWorkflow

router = APIRouter(
    prefix="/journey-06-nibss-transfer",
    tags=["NIBSS Transfer"]
)


@router.post("/transfer/nibss")
async def transfer_nibss(
    request: NIBSSTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    NIBSS Transfer - POST /api/v1/transfer/nibss
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            NIBSSTransferWorkflow,
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

@router.get("/transfer/{id}/status")
async def id_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    NIBSS Transfer - GET /api/v1/transfer/{id}/status
    """
    try:
        # Query database
        result = db.query(Transaction).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/transfer/{id}/receipt")
async def id_receipt(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    NIBSS Transfer - GET /api/v1/transfer/{id}/receipt
    """
    try:
        # Query database
        result = db.query(Transaction).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

