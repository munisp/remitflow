"""
P2P QR Transfer API Endpoints
Journey: journey_10_p2p_qr
FastAPI REST API
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
import uuid

from app.database import get_db
from app.models import User, P2PTransaction, QRCode
from app.schemas import P2PQRTransferRequest, UpdateP2PQRTransferRequest
from app.auth import get_current_user
from app.temporal_client import temporal_client
from app.workflows import P2PQRTransferWorkflow

router = APIRouter(
    prefix="/journey-10-p2p-qr",
    tags=["P2P QR Transfer"]
)


@router.post("/p2p/generate-qr")
async def p2p_generate_qr(
    request: P2PQRTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    P2P QR Transfer - POST /api/v1/p2p/generate-qr
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            P2PQRTransferWorkflow,
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

@router.post("/p2p/scan-qr")
async def p2p_scan_qr(
    request: P2PQRTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    P2P QR Transfer - POST /api/v1/p2p/scan-qr
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            P2PQRTransferWorkflow,
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

@router.post("/p2p/transfer")
async def p2p_transfer(
    request: P2PQRTransferRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    P2P QR Transfer - POST /api/v1/p2p/transfer
    """
    try:
        # Start Temporal workflow
        workflow_id = f"{journey_id}_{uuid.uuid4()}"
        result = await temporal_client.start_workflow(
            P2PQRTransferWorkflow,
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

