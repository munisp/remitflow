"""
Two-Factor Authentication API Endpoints
Journey: journey_03_2fa
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, TwoFactorConfig
from app.schemas import Two-FactorAuthenticationRequest, UpdateTwo-FactorAuthenticationRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import TwoFactorAuthWorkflow

router = APIRouter(
    prefix="/journey-03-2fa",
    tags=["Two-Factor Authentication"]
)


@router.post("/auth/2fa/enable")
async def 2fa_enable(
    request: Two-FactorAuthenticationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Two-Factor Authentication - POST /api/v1/auth/2fa/enable
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            TwoFactorAuthWorkflow,
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

@router.post("/auth/2fa/verify")
async def 2fa_verify(
    request: Two-FactorAuthenticationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Two-Factor Authentication - POST /api/v1/auth/2fa/verify
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            TwoFactorAuthWorkflow,
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

@router.get("/auth/2fa/backup-codes")
async def 2fa_backup_codes(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Two-Factor Authentication - GET /api/v1/auth/2fa/backup-codes
    """
    try:
        # Query database
        result = db.query(TwoFactorConfig).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

