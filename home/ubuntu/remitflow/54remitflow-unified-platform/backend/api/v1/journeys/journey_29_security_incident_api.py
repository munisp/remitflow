"""
Security Incident API Endpoints
Journey: journey_29_security_incident
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, SecurityIncident
from app.schemas import SecurityIncidentRequest, UpdateSecurityIncidentRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import SecurityIncidentWorkflow

router = APIRouter(
    prefix="/journey-29-security-incident",
    tags=["Security Incident"]
)


@router.post("/security/incident/report")
async def incident_report(
    request: SecurityIncidentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Security Incident - POST /api/v1/security/incident/report
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            SecurityIncidentWorkflow,
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

@router.get("/security/incident/{id}/status")
async def id_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Security Incident - GET /api/v1/security/incident/{id}/status
    """
    try:
        # Query database
        result = db.query(SecurityIncident).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

