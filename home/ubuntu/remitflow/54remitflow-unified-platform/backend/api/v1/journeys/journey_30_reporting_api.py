"""
Regulatory Reporting API Endpoints
Journey: journey_30_reporting
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, ComplianceReport
from app.schemas import RegulatoryReportingRequest, UpdateRegulatoryReportingRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import RegulatoryReportingWorkflow

router = APIRouter(
    prefix="/journey-30-reporting",
    tags=["Regulatory Reporting"]
)


@router.post("/compliance/reports/generate")
async def reports_generate(
    request: RegulatoryReportingRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Regulatory Reporting - POST /api/v1/compliance/reports/generate
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            RegulatoryReportingWorkflow,
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

@router.get("/compliance/reports/list")
async def reports_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Regulatory Reporting - GET /api/v1/compliance/reports/list
    """
    try:
        # Query database
        result = db.query(ComplianceReport).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

