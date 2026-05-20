"""
Mojaloop Bulk Transfer Service
Handles batch transfers (salary payments, bulk disbursements)
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum
import uuid
import uvicorn

app = FastAPI(title="Bulk Transfer Service")

class TransferState(str, Enum):
    RECEIVED = "RECEIVED"
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

class IndividualTransfer(BaseModel):
    transferId: str
    transferAmount: Dict[str, str]  # {"currency": "NGN", "amount": "1000"}
    payee: Dict
    payer: Dict

class BulkTransfer(BaseModel):
    bulkTransferId: str
    bulkQuoteId: str
    payerFsp: str
    payeeFsp: str
    individualTransfers: List[IndividualTransfer]
    expiration: str

class BulkTransferResponse(BaseModel):
    bulkTransferId: str
    bulkTransferState: str
    completedTimestamp: Optional[str] = None
    individualTransferResults: List[Dict]

# In-memory storage
bulk_transfers: Dict[str, Dict] = {}

@app.post("/bulkTransfers")
async def create_bulk_transfer(bulk_transfer: BulkTransfer):
    """Create a new bulk transfer"""
    
    bulk_id = bulk_transfer.bulkTransferId
    
    # Store bulk transfer
    bulk_transfers[bulk_id] = {
        "bulkTransferId": bulk_id,
        "bulkQuoteId": bulk_transfer.bulkQuoteId,
        "payerFsp": bulk_transfer.payerFsp,
        "payeeFsp": bulk_transfer.payeeFsp,
        "individualTransfers": [t.dict() for t in bulk_transfer.individualTransfers],
        "state": TransferState.RECEIVED,
        "createdAt": datetime.utcnow().isoformat(),
        "results": []
    }
    
    # Process individual transfers (simplified)
    results = []
    for transfer in bulk_transfer.individualTransfers:
        results.append({
            "transferId": transfer.transferId,
            "transferState": "COMMITTED",
            "fulfilment": str(uuid.uuid4())
        })
    
    bulk_transfers[bulk_id]["results"] = results
    bulk_transfers[bulk_id]["state"] = TransferState.COMPLETED
    bulk_transfers[bulk_id]["completedAt"] = datetime.utcnow().isoformat()
    
    return {
        "bulkTransferId": bulk_id,
        "bulkTransferState": TransferState.COMPLETED,
        "completedTimestamp": bulk_transfers[bulk_id]["completedAt"],
        "individualTransferResults": results
    }

@app.get("/bulkTransfers/{ID}")
async def get_bulk_transfer(ID: str):
    """Get bulk transfer status"""
    
    if ID not in bulk_transfers:
        raise HTTPException(status_code=404, detail="Bulk transfer not found")
    
    bulk = bulk_transfers[ID]
    
    return BulkTransferResponse(
        bulkTransferId=bulk["bulkTransferId"],
        bulkTransferState=bulk["state"],
        completedTimestamp=bulk.get("completedAt"),
        individualTransferResults=bulk["results"]
    )

@app.put("/bulkTransfers/{ID}")
async def update_bulk_transfer(ID: str, state: str):
    """Update bulk transfer state"""
    
    if ID not in bulk_transfers:
        raise HTTPException(status_code=404, detail="Bulk transfer not found")
    
    bulk_transfers[ID]["state"] = state
    bulk_transfers[ID]["updatedAt"] = datetime.utcnow().isoformat()
    
    return {"status": "updated"}

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "bulk-transfer-service"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
