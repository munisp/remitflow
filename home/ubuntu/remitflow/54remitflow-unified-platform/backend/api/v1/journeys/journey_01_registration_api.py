"""
User Registration with KYC API Endpoints
Journey: journey_01_registration
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, User, KYCDocument, OTPVerification
from app.schemas import UserRegistrationwithKYCRequest, UpdateUserRegistrationwithKYCRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import UserRegistrationWorkflow

router = APIRouter(
    prefix="/journey-01-registration",
    tags=["User Registration with KYC"]
)


@router.post("/auth/register")
async def auth_register(
    request: UserRegistrationwithKYCRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    User Registration with KYC - POST /api/v1/auth/register
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            UserRegistrationWorkflow,
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

@router.post("/auth/verify-otp")
async def auth_verify_otp(
    request: UserRegistrationwithKYCRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    User Registration with KYC - POST /api/v1/auth/verify-otp
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            UserRegistrationWorkflow,
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

@router.post("/kyc/upload-document")
async def kyc_upload_document(
    request: UserRegistrationwithKYCRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    User Registration with KYC - POST /api/v1/kyc/upload-document
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            UserRegistrationWorkflow,
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

@router.get("/kyc/status")
async def kyc_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    User Registration with KYC - GET /api/v1/kyc/status
    """
    try:
        # Query database
        result = db.query(User).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

