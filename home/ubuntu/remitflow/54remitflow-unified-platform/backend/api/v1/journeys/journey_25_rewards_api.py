"""
Rewards Redemption API Endpoints
Journey: journey_25_rewards
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, RewardsBalance, Redemption
from app.schemas import RewardsRedemptionRequest, UpdateRewardsRedemptionRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import RewardsRedemptionWorkflow

router = APIRouter(
    prefix="/journey-25-rewards",
    tags=["Rewards Redemption"]
)


@router.get("/rewards/balance")
async def rewards_balance(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rewards Redemption - GET /api/v1/rewards/balance
    """
    try:
        # Query database
        result = db.query(RewardsBalance).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/rewards/options")
async def rewards_options(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rewards Redemption - GET /api/v1/rewards/options
    """
    try:
        # Query database
        result = db.query(RewardsBalance).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rewards/redeem")
async def rewards_redeem(
    request: RewardsRedemptionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Rewards Redemption - POST /api/v1/rewards/redeem
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            RewardsRedemptionWorkflow,
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

