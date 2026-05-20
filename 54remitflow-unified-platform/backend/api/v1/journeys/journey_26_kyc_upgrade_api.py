"""
KYC Upgrade API Endpoints
Journey: journey_26_kyc_upgrade
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, KYCUpgrade
from app.schemas import KYCUpgradeRequest, UpdateKYCUpgradeRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import KYCUpgradeWorkflow

router = APIRouter(
    prefix="/journey-26-kyc-upgrade",
    tags=["KYC Upgrade"]
)


@router.post("/kyc/upgrade/initiate")
async def upgrade_initiate(
    request: KYCUpgradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    KYC Upgrade - POST /api/v1/kyc/upgrade/initiate
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            KYCUpgradeWorkflow,
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

@router.post("/kyc/upgrade/upload")
async def upgrade_upload(
    request: KYCUpgradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    KYC Upgrade - POST /api/v1/kyc/upgrade/upload
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            KYCUpgradeWorkflow,
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

@router.post("/kyc/upgrade/video")
async def upgrade_video(
    request: KYCUpgradeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    KYC Upgrade - POST /api/v1/kyc/upgrade/video
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            KYCUpgradeWorkflow,
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

@router.get("/kyc/upgrade/status")
async def upgrade_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    KYC Upgrade - GET /api/v1/kyc/upgrade/status
    """
    try:
        # Query database
        result = db.query(KYCUpgrade).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

