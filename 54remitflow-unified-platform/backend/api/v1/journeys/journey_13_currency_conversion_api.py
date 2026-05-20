"""
Currency Conversion API Endpoints
Journey: journey_13_currency_conversion
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, CurrencyConversion
from app.schemas import CurrencyConversionRequest, UpdateCurrencyConversionRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import CurrencyConversionWorkflow

router = APIRouter(
    prefix="/journey-13-currency-conversion",
    tags=["Currency Conversion"]
)


@router.post("/wallet/convert/quote")
async def convert_quote(
    request: CurrencyConversionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Currency Conversion - POST /api/v1/wallet/convert/quote
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            CurrencyConversionWorkflow,
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

@router.post("/wallet/convert")
async def wallet_convert(
    request: CurrencyConversionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Currency Conversion - POST /api/v1/wallet/convert
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            CurrencyConversionWorkflow,
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

