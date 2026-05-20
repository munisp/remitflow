"""
Card Service - Virtual card management and 3DS authentication

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from decimal import Decimal
from datetime import datetime
import uvicorn

# Import modules
from virtual_card_manager import VirtualCardManager
from authentication import ThreeDSAuthenticator

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Card Service", version="2.0.0")

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "card-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)

# Initialize managers
card_manager = VirtualCardManager()
auth_manager = ThreeDSAuthenticator()

# Models
class CreateCardRequest(BaseModel):
    user_id: str
    card_type: str
    currency: str
    spending_limit: Decimal
    expiry_months: int = 12

class CardResponse(BaseModel):
    card_id: str
    masked_number: str
    card_type: str
    currency: str
    spending_limit: float
    status: str
    expiry_date: str

class AuthenticationRequest(BaseModel):
    card_id: str
    amount: float
    merchant: str

class VerifyAuthRequest(BaseModel):
    session_id: str
    otp: str

# Routes
@app.post("/api/v1/cards/create")
async def create_virtual_card(request: CreateCardRequest):
    """Create virtual card"""
    card = card_manager.create_virtual_card(
        user_id=request.user_id,
        card_type=request.card_type,
        currency=request.currency,
        spending_limit=request.spending_limit,
        expiry_months=request.expiry_months
    )
    return card

@app.get("/api/v1/cards/{card_id}")
async def get_card(card_id: str):
    """Get card details"""
    card = card_manager.get_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card

@app.get("/api/v1/cards/user/{user_id}")
async def list_user_cards(user_id: str):
    """List user's cards"""
    return card_manager.list_cards(user_id)

@app.post("/api/v1/cards/{card_id}/freeze")
async def freeze_card(card_id: str):
    """Freeze card"""
    card = card_manager.freeze_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card

@app.post("/api/v1/cards/{card_id}/unfreeze")
async def unfreeze_card(card_id: str):
    """Unfreeze card"""
    card = card_manager.unfreeze_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card

@app.post("/api/v1/cards/{card_id}/terminate")
async def terminate_card(card_id: str):
    """Terminate card"""
    card = card_manager.terminate_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card

@app.post("/api/v1/cards/{card_id}/limit")
async def update_limit(card_id: str, new_limit: Decimal):
    """Update spending limit"""
    card = card_manager.update_spending_limit(card_id, new_limit)
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")
    return card

@app.post("/api/v1/cards/auth/initiate")
async def initiate_3ds(request: AuthenticationRequest):
    """Initiate 3DS authentication"""
    return auth_manager.initiate_authentication(
        card_id=request.card_id,
        amount=request.amount,
        merchant=request.merchant
    )

@app.post("/api/v1/cards/auth/verify")
async def verify_3ds(request: VerifyAuthRequest):
    """Verify 3DS authentication"""
    return auth_manager.verify_authentication(
        session_id=request.session_id,
        otp=request.otp
    )

@app.get("/api/v1/cards/stats")
async def get_card_stats():
    """Get card statistics"""
    return card_manager.get_statistics()

@app.get("/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "service": "card-service",
        "version": "2.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8074)
