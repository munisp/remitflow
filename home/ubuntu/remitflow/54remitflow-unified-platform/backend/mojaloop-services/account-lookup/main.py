from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, Dict
from datetime import datetime
import uuid
import httpx

app = FastAPI(
    title="Mojaloop Account Lookup Service (ALS)",
    description="Resolves party identifiers to FSP IDs for routing",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PartyIdInfo(BaseModel):
    partyIdType: str = Field(..., description="MSISDN, EMAIL, IBAN, etc.")
    partyIdentifier: str = Field(..., description="The party identifier value")
    partySubIdOrType: Optional[str] = None
    fspId: Optional[str] = None

class Party(BaseModel):
    partyIdInfo: PartyIdInfo
    merchantClassificationCode: Optional[str] = None
    name: Optional[str] = None
    personalInfo: Optional[Dict] = None

class PartyLookupResponse(BaseModel):
    party: Party

# In-memory registry (production would use Redis/PostgreSQL)
party_registry = {}

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "account-lookup-service",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/participants/{Type}/{ID}")
async def get_participant(
    Type: str,
    ID: str,
    fspiop_source: Optional[str] = Header(None)
):
    """
    Mojaloop API: Get participant FSP for a party identifier
    """
    key = f"{Type}:{ID}"
    
    if key not in party_registry:
        raise HTTPException(
            status_code=404,
            detail={
                "errorInformation": {
                    "errorCode": "3200",
                    "errorDescription": "Party not found"
                }
            }
        )
    
    return {
        "fspId": party_registry[key]["fspId"]
    }

@app.put("/participants/{Type}/{ID}")
async def register_participant(
    Type: str,
    ID: str,
    fspId: str = Header(..., alias="fspiop-source"),
    body: Optional[Dict] = None
):
    """
    Mojaloop API: Register a party identifier with FSP
    """
    key = f"{Type}:{ID}"
    
    party_registry[key] = {
        "fspId": fspId,
        "partyIdType": Type,
        "partyIdentifier": ID,
        "registeredAt": datetime.utcnow().isoformat()
    }
    
    return {"status": "registered"}

@app.get("/parties/{Type}/{ID}")
async def get_party(
    Type: str,
    ID: str,
    fspiop_source: Optional[str] = Header(None)
):
    """
    Mojaloop API: Get party information
    """
    key = f"{Type}:{ID}"
    
    if key not in party_registry:
        raise HTTPException(
            status_code=404,
            detail={
                "errorInformation": {
                    "errorCode": "3201",
                    "errorDescription": "Party not found"
                }
            }
        )
    
    party_data = party_registry[key]
    
    return {
        "party": {
            "partyIdInfo": {
                "partyIdType": Type,
                "partyIdentifier": ID,
                "fspId": party_data["fspId"]
            },
            "name": party_data.get("name", "Unknown")
        }
    }

@app.put("/parties/{Type}/{ID}")
async def update_party(
    Type: str,
    ID: str,
    party: Party,
    fspiop_source: Optional[str] = Header(None)
):
    """
    Mojaloop API: Update party information
    """
    key = f"{Type}:{ID}"
    
    party_registry[key] = {
        "fspId": party.partyIdInfo.fspId,
        "partyIdType": Type,
        "partyIdentifier": ID,
        "name": party.name,
        "updatedAt": datetime.utcnow().isoformat()
    }
    
    return {"status": "updated"}

@app.post("/participants/{Type}/{ID}/error")
async def participant_error(
    Type: str,
    ID: str,
    error: Dict
):
    """
    Mojaloop API: Handle participant lookup errors
    """
    return {"status": "error_received"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
