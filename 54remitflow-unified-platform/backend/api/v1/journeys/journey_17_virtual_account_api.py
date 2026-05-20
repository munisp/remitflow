"""
Virtual Account API Endpoints
Journey: journey_17_virtual_account
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, VirtualAccount
from app.schemas import VirtualAccountRequest, UpdateVirtualAccountRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import VirtualAccountWorkflow

router = APIRouter(
    prefix="/journey-17-virtual-account",
    tags=["Virtual Account"]
)


@router.post("/wallet/virtual-account/create")
async def virtual_account_create(
    request: VirtualAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Virtual Account - POST /api/v1/wallet/virtual-account/create
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            VirtualAccountWorkflow,
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

@router.get("/wallet/virtual-account/details")
async def virtual_account_details(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Virtual Account - GET /api/v1/wallet/virtual-account/details
    """
    try:
        # Query database
        result = db.query(VirtualAccount).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

