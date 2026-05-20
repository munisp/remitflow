"""
Social Login API Endpoints
Journey: journey_05_social_login
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, SocialAccount
from app.schemas import SocialLoginRequest, UpdateSocialLoginRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import SocialLoginWorkflow

router = APIRouter(
    prefix="/journey-05-social-login",
    tags=["Social Login"]
)


@router.get("/auth/social/google")
async def social_google(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Social Login - GET /api/v1/auth/social/google
    """
    try:
        # Query database
        result = db.query(SocialAccount).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/auth/social/facebook")
async def social_facebook(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Social Login - GET /api/v1/auth/social/facebook
    """
    try:
        # Query database
        result = db.query(SocialAccount).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/auth/social/callback")
async def social_callback(
    request: SocialLoginRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Social Login - POST /api/v1/auth/social/callback
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            SocialLoginWorkflow,
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

