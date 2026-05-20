"""
Add Beneficiary API Endpoints
Journey: journey_18_add_beneficiary
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Beneficiary
from app.schemas import AddBeneficiaryRequest, UpdateAddBeneficiaryRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import AddBeneficiaryWorkflow

router = APIRouter(
    prefix="/journey-18-add-beneficiary",
    tags=["Add Beneficiary"]
)


@router.post("/beneficiary/add")
async def beneficiary_add(
    request: AddBeneficiaryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Add Beneficiary - POST /api/v1/beneficiary/add
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            AddBeneficiaryWorkflow,
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

@router.post("/beneficiary/verify")
async def beneficiary_verify(
    request: AddBeneficiaryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Add Beneficiary - POST /api/v1/beneficiary/verify
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            AddBeneficiaryWorkflow,
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

@router.get("/beneficiary/list")
async def beneficiary_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Add Beneficiary - GET /api/v1/beneficiary/list
    """
    try:
        # Query database
        result = db.query(Beneficiary).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

