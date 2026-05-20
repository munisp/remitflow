"""
Mojaloop Account Lookup Service (ALS)
Resolves party identifiers (phone numbers, account IDs) to FSP IDs
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
import uvicorn

app = FastAPI(title="Account Lookup Service")

# In-memory party registry (production would use database)
party_registry: Dict[str, Dict] = {}

class Party(BaseModel):
    partyIdType: str  # MSISDN, ACCOUNT_ID, EMAIL
    partyIdentifier: str
    fspId: str
    currency: str = "NGN"
    displayName: Optional[str] = None

class PartyLookupResponse(BaseModel):
    partyIdInfo: Dict
    party: Dict

@app.post("/participants/{Type}/{ID}")
async def register_participant(Type: str, ID: str, fspId: str):
    """Register a party identifier with an FSP"""
    key = f"{Type}:{ID}"
    party_registry[key] = {
        "partyIdType": Type,
        "partyIdentifier": ID,
        "fspId": fspId
    }
    return {"status": "registered"}

@app.get("/parties/{Type}/{ID}")
async def lookup_party(Type: str, ID: str):
    """Lookup party information by identifier"""
    key = f"{Type}:{ID}"
    
    if key not in party_registry:
        raise HTTPException(status_code=404, detail="Party not found")
    
    party_info = party_registry[key]
    
    return PartyLookupResponse(
        partyIdInfo={
            "partyIdType": party_info["partyIdType"],
            "partyIdentifier": party_info["partyIdentifier"],
            "fspId": party_info["fspId"]
        },
        party={
            "partyIdInfo": party_info,
            "name": party_info.get("displayName", "Unknown"),
            "personalInfo": {
                "complexName": {}
            }
        }
    )

@app.get("/participants/{Type}/{ID}")
async def get_participant(Type: str, ID: str):
    """Get FSP ID for a party identifier"""
    key = f"{Type}:{ID}"
    
    if key not in party_registry:
        raise HTTPException(status_code=404, detail="Participant not found")
    
    return {
        "fspId": party_registry[key]["fspId"]
    }

@app.delete("/participants/{Type}/{ID}")
async def deregister_participant(Type: str, ID: str):
    """Deregister a party identifier"""
    key = f"{Type}:{ID}"
    
    if key in party_registry:
        del party_registry[key]
        return {"status": "deregistered"}
    
    raise HTTPException(status_code=404, detail="Participant not found")

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "account-lookup-service"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
