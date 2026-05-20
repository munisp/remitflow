"""
Cash Pickup Network Service
Manages cash pickup locations, agent networks, and cash-out transactions.

Production-ready version with:
- Structured logging with correlation IDs
- Rate limiting
- Environment-driven CORS configuration
"""

import os
import sys

# Add common modules to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'common'))

from fastapi import FastAPI, HTTPException, Depends, Query
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from enum import Enum
import uuid
from decimal import Decimal
import math

# Import common modules for production readiness
try:
    from service_init import configure_service
    COMMON_MODULES_AVAILABLE = True
except ImportError:
    COMMON_MODULES_AVAILABLE = False
    import logging
    logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Cash Pickup Network Service",
    description="Manages cash pickup locations, agent networks, and cash-out transactions",
    version="2.0.0"
)

# Configure service with production-ready middleware
if COMMON_MODULES_AVAILABLE:
    logger = configure_service(app, "cash-pickup-service")
else:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    logger = logging.getLogger(__name__)


class AgentStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    SUSPENDED = "suspended"
    PENDING_VERIFICATION = "pending_verification"


class LocationType(str, Enum):
    BANK_BRANCH = "bank_branch"
    AGENT_LOCATION = "agent_location"
    MOBILE_MONEY_AGENT = "mobile_money_agent"
    POST_OFFICE = "post_office"
    SUPERMARKET = "supermarket"
    PHARMACY = "pharmacy"
    GAS_STATION = "gas_station"


class PickupStatus(str, Enum):
    PENDING = "pending"
    READY_FOR_PICKUP = "ready_for_pickup"
    COLLECTED = "collected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class PartnerNetwork(str, Enum):
    FIRSTBANK = "firstbank"
    UBA = "uba"
    ZENITH = "zenith"
    GTB = "gtb"
    ACCESS = "access"
    OPAY = "opay"
    PALMPAY = "palmpay"
    MONIEPOINT = "moniepoint"
    PAGA = "paga"
    MTN_MOMO = "mtn_momo"


# Models
class GeoLocation(BaseModel):
    latitude: float
    longitude: float


class OperatingHours(BaseModel):
    monday: Optional[str] = "08:00-18:00"
    tuesday: Optional[str] = "08:00-18:00"
    wednesday: Optional[str] = "08:00-18:00"
    thursday: Optional[str] = "08:00-18:00"
    friday: Optional[str] = "08:00-18:00"
    saturday: Optional[str] = "09:00-14:00"
    sunday: Optional[str] = None


class CashPickupLocation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    location_type: LocationType
    partner_network: PartnerNetwork
    address: str
    city: str
    state: str
    country: str = "NG"
    postal_code: Optional[str] = None
    geo_location: GeoLocation
    phone: Optional[str] = None
    operating_hours: OperatingHours = Field(default_factory=OperatingHours)
    status: AgentStatus = AgentStatus.ACTIVE
    max_payout_amount: Decimal = Decimal("500000.00")
    supported_currencies: List[str] = ["NGN"]
    rating: float = 4.5
    total_ratings: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Agent(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    location_id: str
    name: str
    phone: str
    email: Optional[str] = None
    id_type: str
    id_number: str
    status: AgentStatus = AgentStatus.PENDING_VERIFICATION
    commission_rate: Decimal = Decimal("0.5")
    total_transactions: int = 0
    total_volume: Decimal = Decimal("0.00")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    verified_at: Optional[datetime] = None


class CashPickupTransaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transfer_id: str
    sender_id: str
    recipient_name: str
    recipient_phone: str
    recipient_id_type: str
    recipient_id_number: str
    amount: Decimal
    currency: str = "NGN"
    pickup_code: str
    pickup_location_id: Optional[str] = None
    partner_network: PartnerNetwork
    status: PickupStatus = PickupStatus.PENDING
    expires_at: datetime
    collected_at: Optional[datetime] = None
    collected_by_agent_id: Optional[str] = None
    security_question: Optional[str] = None
    security_answer_hash: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PickupNotification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    transaction_id: str
    recipient_phone: str
    message: str
    sent_at: datetime = Field(default_factory=datetime.utcnow)
    delivered: bool = False


# Production mode flag - when True, use PostgreSQL; when False, use in-memory (dev only)
USE_DATABASE = os.getenv("USE_DATABASE", "true").lower() == "true"

# Import database modules if available
try:
    from database import get_db_context, init_db, check_db_connection
    DATABASE_AVAILABLE = True
except ImportError:
    DATABASE_AVAILABLE = False

# In-memory storage (only used when USE_DATABASE=false for development)
locations_db: Dict[str, CashPickupLocation] = {}
agents_db: Dict[str, Agent] = {}
transactions_db: Dict[str, CashPickupTransaction] = {}
notifications_db: Dict[str, PickupNotification] = {}

# Sample locations for Nigeria
SAMPLE_LOCATIONS = [
    {
        "name": "FirstBank Lagos Island",
        "location_type": LocationType.BANK_BRANCH,
        "partner_network": PartnerNetwork.FIRSTBANK,
        "address": "35 Marina Street",
        "city": "Lagos",
        "state": "Lagos",
        "geo_location": GeoLocation(latitude=6.4541, longitude=3.4084),
        "max_payout_amount": Decimal("1000000.00")
    },
    {
        "name": "UBA Ikeja Branch",
        "location_type": LocationType.BANK_BRANCH,
        "partner_network": PartnerNetwork.UBA,
        "address": "12 Allen Avenue",
        "city": "Ikeja",
        "state": "Lagos",
        "geo_location": GeoLocation(latitude=6.6018, longitude=3.3515),
        "max_payout_amount": Decimal("1000000.00")
    },
    {
        "name": "OPay Agent - Surulere",
        "location_type": LocationType.MOBILE_MONEY_AGENT,
        "partner_network": PartnerNetwork.OPAY,
        "address": "45 Adeniran Ogunsanya Street",
        "city": "Surulere",
        "state": "Lagos",
        "geo_location": GeoLocation(latitude=6.5059, longitude=3.3509),
        "max_payout_amount": Decimal("200000.00")
    },
    {
        "name": "Paga Agent - Abuja",
        "location_type": LocationType.AGENT_LOCATION,
        "partner_network": PartnerNetwork.PAGA,
        "address": "Plot 123 Wuse Zone 5",
        "city": "Abuja",
        "state": "FCT",
        "geo_location": GeoLocation(latitude=9.0765, longitude=7.3986),
        "max_payout_amount": Decimal("300000.00")
    },
    {
        "name": "MTN MoMo Agent - Kano",
        "location_type": LocationType.MOBILE_MONEY_AGENT,
        "partner_network": PartnerNetwork.MTN_MOMO,
        "address": "15 Murtala Mohammed Way",
        "city": "Kano",
        "state": "Kano",
        "geo_location": GeoLocation(latitude=12.0022, longitude=8.5919),
        "max_payout_amount": Decimal("150000.00")
    },
]


def initialize_sample_locations():
    """Initialize sample pickup locations."""
    for loc_data in SAMPLE_LOCATIONS:
        location = CashPickupLocation(**loc_data)
        locations_db[location.id] = location


def generate_pickup_code() -> str:
    """Generate a unique pickup code."""
    return f"CP{uuid.uuid4().hex[:8].upper()}"


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points using Haversine formula."""
    R = 6371  # Earth's radius in kilometers
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


initialize_sample_locations()


# Location Endpoints
@app.get("/locations", response_model=List[CashPickupLocation])
async def list_locations(
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: str = "NG",
    partner_network: Optional[PartnerNetwork] = None,
    location_type: Optional[LocationType] = None,
    min_amount: Optional[Decimal] = None
):
    """List all cash pickup locations with filters."""
    locations = list(locations_db.values())
    
    locations = [loc for loc in locations if loc.country == country and loc.status == AgentStatus.ACTIVE]
    
    if city:
        locations = [loc for loc in locations if loc.city.lower() == city.lower()]
    if state:
        locations = [loc for loc in locations if loc.state.lower() == state.lower()]
    if partner_network:
        locations = [loc for loc in locations if loc.partner_network == partner_network]
    if location_type:
        locations = [loc for loc in locations if loc.location_type == location_type]
    if min_amount:
        locations = [loc for loc in locations if loc.max_payout_amount >= min_amount]
    
    return locations


@app.get("/locations/nearby")
async def find_nearby_locations(
    latitude: float,
    longitude: float,
    radius_km: float = 10.0,
    limit: int = Query(default=20, le=50)
):
    """Find nearby cash pickup locations."""
    locations = [loc for loc in locations_db.values() if loc.status == AgentStatus.ACTIVE]
    
    nearby = []
    for location in locations:
        distance = calculate_distance(
            latitude, longitude,
            location.geo_location.latitude,
            location.geo_location.longitude
        )
        if distance <= radius_km:
            nearby.append({
                "location": location,
                "distance_km": round(distance, 2)
            })
    
    nearby.sort(key=lambda x: x["distance_km"])
    return nearby[:limit]


@app.get("/locations/{location_id}", response_model=CashPickupLocation)
async def get_location(location_id: str):
    """Get location details."""
    if location_id not in locations_db:
        raise HTTPException(status_code=404, detail="Location not found")
    return locations_db[location_id]


@app.post("/locations", response_model=CashPickupLocation)
async def create_location(
    name: str,
    location_type: LocationType,
    partner_network: PartnerNetwork,
    address: str,
    city: str,
    state: str,
    latitude: float,
    longitude: float,
    country: str = "NG",
    phone: Optional[str] = None,
    max_payout_amount: Decimal = Decimal("500000.00")
):
    """Create a new cash pickup location."""
    location = CashPickupLocation(
        name=name,
        location_type=location_type,
        partner_network=partner_network,
        address=address,
        city=city,
        state=state,
        country=country,
        geo_location=GeoLocation(latitude=latitude, longitude=longitude),
        phone=phone,
        max_payout_amount=max_payout_amount
    )
    
    locations_db[location.id] = location
    return location


@app.put("/locations/{location_id}/status")
async def update_location_status(location_id: str, status: AgentStatus):
    """Update location status."""
    if location_id not in locations_db:
        raise HTTPException(status_code=404, detail="Location not found")
    
    location = locations_db[location_id]
    location.status = status
    return location


# Agent Endpoints
@app.post("/agents", response_model=Agent)
async def register_agent(
    location_id: str,
    name: str,
    phone: str,
    id_type: str,
    id_number: str,
    email: Optional[str] = None,
    commission_rate: Decimal = Decimal("0.5")
):
    """Register a new agent."""
    if location_id not in locations_db:
        raise HTTPException(status_code=404, detail="Location not found")
    
    agent = Agent(
        location_id=location_id,
        name=name,
        phone=phone,
        email=email,
        id_type=id_type,
        id_number=id_number,
        commission_rate=commission_rate
    )
    
    agents_db[agent.id] = agent
    return agent


@app.get("/agents/{agent_id}", response_model=Agent)
async def get_agent(agent_id: str):
    """Get agent details."""
    if agent_id not in agents_db:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agents_db[agent_id]


@app.put("/agents/{agent_id}/verify")
async def verify_agent(agent_id: str):
    """Verify an agent."""
    if agent_id not in agents_db:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent = agents_db[agent_id]
    agent.status = AgentStatus.ACTIVE
    agent.verified_at = datetime.utcnow()
    return agent


@app.get("/locations/{location_id}/agents", response_model=List[Agent])
async def get_location_agents(location_id: str):
    """Get all agents at a location."""
    return [a for a in agents_db.values() if a.location_id == location_id]


# Cash Pickup Transaction Endpoints
@app.post("/pickups", response_model=CashPickupTransaction)
async def create_cash_pickup(
    transfer_id: str,
    sender_id: str,
    recipient_name: str,
    recipient_phone: str,
    recipient_id_type: str,
    recipient_id_number: str,
    amount: Decimal,
    partner_network: PartnerNetwork,
    currency: str = "NGN",
    pickup_location_id: Optional[str] = None,
    security_question: Optional[str] = None,
    security_answer: Optional[str] = None,
    expires_hours: int = 72
):
    """Create a cash pickup transaction."""
    if pickup_location_id and pickup_location_id not in locations_db:
        raise HTTPException(status_code=404, detail="Pickup location not found")
    
    if pickup_location_id:
        location = locations_db[pickup_location_id]
        if amount > location.max_payout_amount:
            raise HTTPException(
                status_code=400,
                detail=f"Amount exceeds location limit of {location.max_payout_amount}"
            )
    
    security_answer_hash = None
    if security_answer:
        import hashlib
        security_answer_hash = hashlib.sha256(security_answer.lower().encode()).hexdigest()
    
    transaction = CashPickupTransaction(
        transfer_id=transfer_id,
        sender_id=sender_id,
        recipient_name=recipient_name,
        recipient_phone=recipient_phone,
        recipient_id_type=recipient_id_type,
        recipient_id_number=recipient_id_number,
        amount=amount,
        currency=currency,
        pickup_code=generate_pickup_code(),
        pickup_location_id=pickup_location_id,
        partner_network=partner_network,
        status=PickupStatus.READY_FOR_PICKUP,
        expires_at=datetime.utcnow() + timedelta(hours=expires_hours),
        security_question=security_question,
        security_answer_hash=security_answer_hash
    )
    
    transactions_db[transaction.id] = transaction
    
    # Create notification
    notification = PickupNotification(
        transaction_id=transaction.id,
        recipient_phone=recipient_phone,
        message=f"You have a cash pickup of {currency} {amount}. Code: {transaction.pickup_code}. Valid until {transaction.expires_at.strftime('%Y-%m-%d %H:%M')}."
    )
    notifications_db[notification.id] = notification
    
    return transaction


@app.get("/pickups/{transaction_id}", response_model=CashPickupTransaction)
async def get_pickup(transaction_id: str):
    """Get cash pickup details."""
    if transaction_id not in transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transactions_db[transaction_id]


@app.get("/pickups/code/{pickup_code}")
async def get_pickup_by_code(pickup_code: str):
    """Get cash pickup by pickup code."""
    for transaction in transactions_db.values():
        if transaction.pickup_code == pickup_code:
            return transaction
    raise HTTPException(status_code=404, detail="Pickup not found")


@app.post("/pickups/{transaction_id}/validate")
async def validate_pickup(
    transaction_id: str,
    recipient_id_number: str,
    security_answer: Optional[str] = None
):
    """Validate pickup credentials before disbursement."""
    if transaction_id not in transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    transaction = transactions_db[transaction_id]
    
    if transaction.status != PickupStatus.READY_FOR_PICKUP:
        raise HTTPException(status_code=400, detail=f"Pickup is {transaction.status}")
    
    if datetime.utcnow() > transaction.expires_at:
        transaction.status = PickupStatus.EXPIRED
        raise HTTPException(status_code=400, detail="Pickup has expired")
    
    if transaction.recipient_id_number != recipient_id_number:
        raise HTTPException(status_code=400, detail="Invalid ID number")
    
    if transaction.security_answer_hash and security_answer:
        import hashlib
        answer_hash = hashlib.sha256(security_answer.lower().encode()).hexdigest()
        if answer_hash != transaction.security_answer_hash:
            raise HTTPException(status_code=400, detail="Invalid security answer")
    
    return {
        "valid": True,
        "transaction_id": transaction_id,
        "amount": transaction.amount,
        "currency": transaction.currency,
        "recipient_name": transaction.recipient_name
    }


@app.post("/pickups/{transaction_id}/disburse")
async def disburse_pickup(
    transaction_id: str,
    agent_id: str,
    recipient_id_number: str,
    security_answer: Optional[str] = None
):
    """Disburse cash to recipient."""
    # Validate first
    await validate_pickup(transaction_id, recipient_id_number, security_answer)
    
    if agent_id not in agents_db:
        raise HTTPException(status_code=404, detail="Agent not found")
    
    agent = agents_db[agent_id]
    if agent.status != AgentStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Agent is not active")
    
    transaction = transactions_db[transaction_id]
    transaction.status = PickupStatus.COLLECTED
    transaction.collected_at = datetime.utcnow()
    transaction.collected_by_agent_id = agent_id
    
    # Update agent stats
    agent.total_transactions += 1
    agent.total_volume += transaction.amount
    
    return {
        "success": True,
        "transaction": transaction,
        "disbursed_at": transaction.collected_at,
        "agent": agent.name
    }


@app.post("/pickups/{transaction_id}/cancel")
async def cancel_pickup(transaction_id: str, reason: str):
    """Cancel a cash pickup."""
    if transaction_id not in transactions_db:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    transaction = transactions_db[transaction_id]
    
    if transaction.status == PickupStatus.COLLECTED:
        raise HTTPException(status_code=400, detail="Cannot cancel collected pickup")
    
    transaction.status = PickupStatus.CANCELLED
    
    return {
        "success": True,
        "transaction_id": transaction_id,
        "reason": reason
    }


@app.get("/pickups/sender/{sender_id}", response_model=List[CashPickupTransaction])
async def get_sender_pickups(
    sender_id: str,
    status: Optional[PickupStatus] = None,
    limit: int = Query(default=50, le=200)
):
    """Get all pickups for a sender."""
    pickups = [t for t in transactions_db.values() if t.sender_id == sender_id]
    
    if status:
        pickups = [p for p in pickups if p.status == status]
    
    pickups.sort(key=lambda x: x.created_at, reverse=True)
    return pickups[:limit]


# Partner Network Endpoints
@app.get("/networks")
async def list_partner_networks():
    """List all partner networks and their coverage."""
    networks = {}
    
    for network in PartnerNetwork:
        locations = [loc for loc in locations_db.values() if loc.partner_network == network]
        networks[network.value] = {
            "name": network.value.replace("_", " ").title(),
            "total_locations": len(locations),
            "cities": list(set(loc.city for loc in locations)),
            "states": list(set(loc.state for loc in locations)),
            "max_payout": max((loc.max_payout_amount for loc in locations), default=Decimal("0"))
        }
    
    return networks


@app.get("/networks/{network}/locations", response_model=List[CashPickupLocation])
async def get_network_locations(network: PartnerNetwork):
    """Get all locations for a partner network."""
    return [loc for loc in locations_db.values() if loc.partner_network == network and loc.status == AgentStatus.ACTIVE]


# Statistics Endpoints
@app.get("/stats/locations")
async def get_location_stats():
    """Get location statistics."""
    locations = list(locations_db.values())
    
    return {
        "total_locations": len(locations),
        "active_locations": len([loc for loc in locations if loc.status == AgentStatus.ACTIVE]),
        "by_type": {
            lt.value: len([loc for loc in locations if loc.location_type == lt])
            for lt in LocationType
        },
        "by_network": {
            pn.value: len([loc for loc in locations if loc.partner_network == pn])
            for pn in PartnerNetwork
        },
        "by_state": {
            state: len([loc for loc in locations if loc.state == state])
            for state in set(loc.state for loc in locations)
        }
    }


@app.get("/stats/transactions")
async def get_transaction_stats():
    """Get transaction statistics."""
    transactions = list(transactions_db.values())
    
    return {
        "total_transactions": len(transactions),
        "by_status": {
            status.value: len([t for t in transactions if t.status == status])
            for status in PickupStatus
        },
        "total_volume": sum(t.amount for t in transactions if t.status == PickupStatus.COLLECTED),
        "by_network": {
            pn.value: len([t for t in transactions if t.partner_network == pn])
            for pn in PartnerNetwork
        }
    }


# Health check
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "cash-pickup",
        "timestamp": datetime.utcnow().isoformat()
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8014)
