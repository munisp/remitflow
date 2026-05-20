"""
Card Management API Endpoints
Journey: journey_19_card_management
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Card
from app.schemas import CardManagementRequest, UpdateCardManagementRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import CardManagementWorkflow

router = APIRouter(
    prefix="/journey-19-card-management",
    tags=["Card Management"]
)


@router.post("/cards/add")
async def cards_add(
    request: CardManagementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Card Management - POST /api/v1/cards/add
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            CardManagementWorkflow,
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

@router.put("/cards/{id}/freeze")
async def id_freeze(
    request: UpdateCardManagementRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Card Management - PUT /api/v1/cards/{id}/freeze
    """
    try:
        # Update logic
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/cards/{id}")
async def cards_id(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Card Management - DELETE /api/v1/cards/{id}
    """
    try:
        # Delete logic
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cards/list")
async def cards_list(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Card Management - GET /api/v1/cards/list
    """
    try:
        # Query database
        result = db.query(Card).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

