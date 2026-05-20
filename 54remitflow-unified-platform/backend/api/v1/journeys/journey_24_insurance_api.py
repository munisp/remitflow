"""
Insurance Purchase API Endpoints
Journey: journey_24_insurance
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, InsurancePolicy, InsuranceClaim
from app.schemas import InsurancePurchaseRequest, UpdateInsurancePurchaseRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import InsuranceWorkflow

router = APIRouter(
    prefix="/journey-24-insurance",
    tags=["Insurance Purchase"]
)


@router.get("/insurance/products")
async def insurance_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Insurance Purchase - GET /api/v1/insurance/products
    """
    try:
        # Query database
        result = db.query(InsurancePolicy).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/insurance/quote")
async def insurance_quote(
    request: InsurancePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Insurance Purchase - POST /api/v1/insurance/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            InsuranceWorkflow,
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

@router.post("/insurance/purchase")
async def insurance_purchase(
    request: InsurancePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Insurance Purchase - POST /api/v1/insurance/purchase
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            InsuranceWorkflow,
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

@router.post("/insurance/claims")
async def insurance_claims(
    request: InsurancePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Insurance Purchase - POST /api/v1/insurance/claims
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            InsuranceWorkflow,
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

