"""
Airtime Top-up API Endpoints
Journey: journey_09_airtime_topup
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, AirtimeTransaction
from app.schemas import AirtimeTop-upRequest, UpdateAirtimeTop-upRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import AirtimeTopupWorkflow

router = APIRouter(
    prefix="/journey-09-airtime-topup",
    tags=["Airtime Top-up"]
)


@router.get("/airtime/providers")
async def airtime_providers(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Airtime Top-up - GET /api/v1/airtime/providers
    """
    try:
        # Query database
        result = db.query(AirtimeTransaction).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/airtime/topup")
async def airtime_topup(
    request: AirtimeTop-upRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Airtime Top-up - POST /api/v1/airtime/topup
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            AirtimeTopupWorkflow,
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

