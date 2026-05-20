"""
Biometric Authentication Setup API Endpoints
Journey: journey_02_biometric
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, BiometricTemplate
from app.schemas import BiometricAuthenticationSetupRequest, UpdateBiometricAuthenticationSetupRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import BiometricSetupWorkflow

router = APIRouter(
    prefix="/journey-02-biometric",
    tags=["Biometric Authentication Setup"]
)


@router.post("/auth/biometric/setup")
async def biometric_setup(
    request: BiometricAuthenticationSetupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Biometric Authentication Setup - POST /api/v1/auth/biometric/setup
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            BiometricSetupWorkflow,
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

@router.post("/auth/biometric/verify")
async def biometric_verify(
    request: BiometricAuthenticationSetupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Biometric Authentication Setup - POST /api/v1/auth/biometric/verify
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            BiometricSetupWorkflow,
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

@router.get("/auth/biometric/status")
async def biometric_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Biometric Authentication Setup - GET /api/v1/auth/biometric/status
    """
    try:
        # Query database
        result = db.query(BiometricTemplate).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

