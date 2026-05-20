"""
Investment Portfolio API Endpoints
Journey: journey_22_investment
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, Investment, Portfolio
from app.schemas import InvestmentPortfolioRequest, UpdateInvestmentPortfolioRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import InvestmentWorkflow

router = APIRouter(
    prefix="/journey-22-investment",
    tags=["Investment Portfolio"]
)


@router.post("/investment/risk-assessment")
async def investment_risk_assessment(
    request: InvestmentPortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Investment Portfolio - POST /api/v1/investment/risk-assessment
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            InvestmentWorkflow,
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

@router.get("/investment/products")
async def investment_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Investment Portfolio - GET /api/v1/investment/products
    """
    try:
        # Query database
        result = db.query(Investment).filter_by(user_id=current_user.id).all()
        return {
            "success": True,
            "data": [item.to_dict() for item in result]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/investment/invest")
async def investment_invest(
    request: InvestmentPortfolioRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Investment Portfolio - POST /api/v1/investment/invest
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            InvestmentWorkflow,
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

