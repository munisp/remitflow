"""
Fraud Detection API Endpoints
Journey: journey_28_fraud
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, FraudAlert
from app.schemas import FraudDetectionRequest, UpdateFraudDetectionRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import FraudDetectionWorkflow

router = APIRouter(
    prefix="/journey-28-fraud",
    tags=["Fraud Detection"]
)


@router.post("/security/fraud/analyze")
async def fraud_analyze(
    request: FraudDetectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Fraud Detection - POST /api/v1/security/fraud/analyze
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            FraudDetectionWorkflow,
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

@router.get("/security/fraud/alerts")
async def fraud_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Fraud Detection - GET /api/v1/security/fraud/alerts
    """
    try:
        # Query database
        result = db.query(FraudAlert).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

