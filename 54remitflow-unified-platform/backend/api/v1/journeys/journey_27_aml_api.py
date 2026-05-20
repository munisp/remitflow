"""
AML Monitoring API Endpoints
Journey: journey_27_aml
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, AMLAlert, SuspiciousActivityReport
from app.schemas import AMLMonitoringRequest, UpdateAMLMonitoringRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import AMLMonitoringWorkflow

router = APIRouter(
    prefix="/journey-27-aml",
    tags=["AML Monitoring"]
)


@router.get("/compliance/aml/transactions")
async def aml_transactions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AML Monitoring - GET /api/v1/compliance/aml/transactions
    """
    try:
        # Query database
        result = db.query(AMLAlert).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/compliance/aml/review")
async def aml_review(
    request: AMLMonitoringRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AML Monitoring - POST /api/v1/compliance/aml/review
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            AMLMonitoringWorkflow,
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

@router.post("/compliance/aml/report")
async def aml_report(
    request: AMLMonitoringRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    AML Monitoring - POST /api/v1/compliance/aml/report
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            AMLMonitoringWorkflow,
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

