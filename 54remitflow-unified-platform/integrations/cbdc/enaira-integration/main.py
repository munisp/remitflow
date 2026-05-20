"""
eNaira CBDC Integration Service
Provides API integration with Central Bank of Nigeria's eNaira digital currency
"""

from fastapi import FastAPI, HTTPException, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, validator
from typing import Optional, List
from datetime import datetime
import uuid
import logging
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="eNaira CBDC Integration Service",
    description="Integration service for Central Bank of Nigeria eNaira digital currency",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class TransactionStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"

class WalletType(str, Enum):
    INDIVIDUAL = "individual"
    BUSINESS = "business"
    MERCHANT = "merchant"

class CreateWalletRequest(BaseModel):
    customer_id: str = Field(..., description="Unique customer identifier")
    wallet_type: WalletType = Field(default=WalletType.INDIVIDUAL)
    phone_number: str = Field(..., pattern=r"^\+234[0-9]{10}$")
    bvn: str = Field(..., min_length=11, max_length=11, description="Bank Verification Number")
    email: Optional[str] = None
    
    @validator('bvn')
    def validate_bvn(cls, v):
        if not v.isdigit():
            raise ValueError('BVN must contain only digits')
        return v

class TransferRequest(BaseModel):
    from_wallet_id: str
    to_wallet_id: str
    amount: float = Field(..., gt=0, description="Amount in Naira")
    narration: str = Field(..., max_length=200)
    reference: Optional[str] = None
    
    @validator('amount')
    def validate_amount(cls, v):
        if v <= 0:
            raise ValueError('Amount must be greater than 0')
        if v > 1000000:  # Max 1M NGN per transaction
            raise ValueError('Amount exceeds maximum transaction limit')
        return round(v, 2)

class BalanceQuery(BaseModel):
    wallet_id: str

class WalletResponse(BaseModel):
    wallet_id: str
    customer_id: str
    wallet_type: WalletType
    balance: float
    status: str
    created_at: datetime
    phone_number: str

class TransferResponse(BaseModel):
    transaction_id: str
    from_wallet_id: str
    to_wallet_id: str
    amount: float
    status: TransactionStatus
    narration: str
    reference: Optional[str]
    timestamp: datetime
    fee: float = 0.0

# In-memory storage (replace with actual database in production)
wallets_db = {}
transactions_db = {}

# Mock CBN API client
class CBNAPIClient:
    """Mock Central Bank of Nigeria API client"""
    
    def __init__(self, api_key: str, api_url: str):
        self.api_key = api_key
        self.api_url = api_url
        logger.info(f"Initialized CBN API client for {api_url}")
    
    async def create_wallet(self, customer_data: dict) -> dict:
        """Create eNaira wallet via CBN API"""
        # Mock implementation - replace with actual CBN API call
        wallet_id = f"ENAIRA-{uuid.uuid4().hex[:12].upper()}"
        logger.info(f"Created wallet {wallet_id} for customer {customer_data['customer_id']}")
        return {
            "wallet_id": wallet_id,
            "status": "active",
            "balance": 0.0,
            "created_at": datetime.utcnow()
        }
    
    async def transfer_funds(self, transfer_data: dict) -> dict:
        """Execute eNaira transfer via CBN API"""
        # Mock implementation - replace with actual CBN API call
        transaction_id = f"TXN-{uuid.uuid4().hex[:16].upper()}"
        logger.info(f"Processing transfer {transaction_id}: {transfer_data['amount']} NGN")
        
        # Simulate processing
        return {
            "transaction_id": transaction_id,
            "status": TransactionStatus.COMPLETED,
            "timestamp": datetime.utcnow(),
            "fee": 0.0  # eNaira transfers are typically free
        }
    
    async def get_balance(self, wallet_id: str) -> float:
        """Get wallet balance from CBN API"""
        # Mock implementation - replace with actual CBN API call
        if wallet_id in wallets_db:
            return wallets_db[wallet_id]["balance"]
        raise ValueError(f"Wallet {wallet_id} not found")
    
    async def get_transaction_status(self, transaction_id: str) -> dict:
        """Get transaction status from CBN API"""
        # Mock implementation
        if transaction_id in transactions_db:
            return transactions_db[transaction_id]
        raise ValueError(f"Transaction {transaction_id} not found")

# Initialize CBN API client
cbn_client = CBNAPIClient(
    api_key="mock-api-key",  # Replace with actual API key from environment
    api_url="https://api.cbn.gov.ng/enaira/v1"  # Replace with actual CBN API URL
)

# API Key validation
async def verify_api_key(x_api_key: str = Header(...)):
    """Verify API key for authentication"""
    # Replace with actual API key validation
    if x_api_key != "your-secret-api-key":
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key

# Endpoints
@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "eNaira CBDC Integration",
        "status": "operational",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health")
async def health_check():
    """Detailed health check"""
    return {
        "status": "healthy",
        "cbn_api": "connected",
        "wallets_count": len(wallets_db),
        "transactions_count": len(transactions_db),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/v1/wallet/create", response_model=WalletResponse)
async def create_wallet(
    request: CreateWalletRequest,
    api_key: str = Depends(verify_api_key)
):
    """Create a new eNaira wallet"""
    try:
        # Call CBN API to create wallet
        cbn_response = await cbn_client.create_wallet({
            "customer_id": request.customer_id,
            "wallet_type": request.wallet_type,
            "phone_number": request.phone_number,
            "bvn": request.bvn,
            "email": request.email
        })
        
        # Store wallet info
        wallet_data = {
            "wallet_id": cbn_response["wallet_id"],
            "customer_id": request.customer_id,
            "wallet_type": request.wallet_type,
            "balance": cbn_response["balance"],
            "status": cbn_response["status"],
            "created_at": cbn_response["created_at"],
            "phone_number": request.phone_number,
            "bvn": request.bvn,
            "email": request.email
        }
        
        wallets_db[cbn_response["wallet_id"]] = wallet_data
        
        logger.info(f"Wallet created successfully: {cbn_response['wallet_id']}")
        
        return WalletResponse(**wallet_data)
        
    except Exception as e:
        logger.error(f"Error creating wallet: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create wallet: {str(e)}")

@app.post("/api/v1/transfer", response_model=TransferResponse)
async def transfer_funds(
    request: TransferRequest,
    api_key: str = Depends(verify_api_key)
):
    """Execute eNaira transfer between wallets"""
    try:
        # Validate wallets exist
        if request.from_wallet_id not in wallets_db:
            raise HTTPException(status_code=404, detail="Source wallet not found")
        if request.to_wallet_id not in wallets_db:
            raise HTTPException(status_code=404, detail="Destination wallet not found")
        
        # Check balance
        from_wallet = wallets_db[request.from_wallet_id]
        if from_wallet["balance"] < request.amount:
            raise HTTPException(status_code=400, detail="Insufficient balance")
        
        # Execute transfer via CBN API
        cbn_response = await cbn_client.transfer_funds({
            "from_wallet_id": request.from_wallet_id,
            "to_wallet_id": request.to_wallet_id,
            "amount": request.amount,
            "narration": request.narration,
            "reference": request.reference or str(uuid.uuid4())
        })
        
        # Update balances
        wallets_db[request.from_wallet_id]["balance"] -= request.amount
        wallets_db[request.to_wallet_id]["balance"] += request.amount
        
        # Store transaction
        transaction_data = {
            "transaction_id": cbn_response["transaction_id"],
            "from_wallet_id": request.from_wallet_id,
            "to_wallet_id": request.to_wallet_id,
            "amount": request.amount,
            "status": cbn_response["status"],
            "narration": request.narration,
            "reference": request.reference,
            "timestamp": cbn_response["timestamp"],
            "fee": cbn_response["fee"]
        }
        
        transactions_db[cbn_response["transaction_id"]] = transaction_data
        
        logger.info(f"Transfer completed: {cbn_response['transaction_id']}")
        
        return TransferResponse(**transaction_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing transfer: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transfer failed: {str(e)}")

@app.get("/api/v1/wallet/balance/{wallet_id}")
async def get_balance(
    wallet_id: str,
    api_key: str = Depends(verify_api_key)
):
    """Get wallet balance"""
    try:
        if wallet_id not in wallets_db:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        balance = await cbn_client.get_balance(wallet_id)
        
        return {
            "wallet_id": wallet_id,
            "balance": balance,
            "currency": "NGN",
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting balance: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get balance: {str(e)}")

@app.get("/api/v1/transaction/{transaction_id}")
async def get_transaction(
    transaction_id: str,
    api_key: str = Depends(verify_api_key)
):
    """Get transaction details"""
    try:
        if transaction_id not in transactions_db:
            raise HTTPException(status_code=404, detail="Transaction not found")
        
        return transactions_db[transaction_id]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting transaction: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get transaction: {str(e)}")

@app.get("/api/v1/wallet/{wallet_id}/transactions")
async def get_wallet_transactions(
    wallet_id: str,
    limit: int = 50,
    api_key: str = Depends(verify_api_key)
):
    """Get transaction history for a wallet"""
    try:
        if wallet_id not in wallets_db:
            raise HTTPException(status_code=404, detail="Wallet not found")
        
        # Filter transactions for this wallet
        wallet_transactions = [
            tx for tx in transactions_db.values()
            if tx["from_wallet_id"] == wallet_id or tx["to_wallet_id"] == wallet_id
        ]
        
        # Sort by timestamp descending
        wallet_transactions.sort(key=lambda x: x["timestamp"], reverse=True)
        
        return {
            "wallet_id": wallet_id,
            "transactions": wallet_transactions[:limit],
            "total": len(wallet_transactions)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting transactions: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get transactions: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
