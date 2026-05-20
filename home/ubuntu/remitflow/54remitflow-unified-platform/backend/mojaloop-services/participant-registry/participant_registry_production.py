"""
Production-Ready Mojaloop Participant Registry
Manages FSP onboarding, credentials, endpoints, and limits.

Features:
- FSP registration and onboarding
- Endpoint management (callbacks, APIs)
- Credential management (certificates, API keys)
- Limit configuration
- FSP status management
- Integration with Central Ledger
"""

import os
import json
import logging
import secrets
import hashlib
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
from contextlib import asynccontextmanager
import uuid
import base64

from fastapi import FastAPI, HTTPException, Header, Depends, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, Field, validator, EmailStr
import asyncpg
import httpx
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ==================== Configuration ====================

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://mojaloop:mojaloop@localhost:5432/mojaloop")
    CENTRAL_LEDGER_URL = os.getenv("CENTRAL_LEDGER_URL", "http://localhost:8001")
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
    
    # Security
    API_KEY_HEADER = "X-API-Key"
    ADMIN_API_KEY = os.getenv("ADMIN_API_KEY")  # Required for admin operations
    
    # Defaults
    DEFAULT_NDC = Decimal(os.getenv("DEFAULT_NDC", "1000000000"))
    DEFAULT_DAILY_LIMIT = Decimal(os.getenv("DEFAULT_DAILY_LIMIT", "100000000"))
    DEFAULT_TRANSACTION_LIMIT = Decimal(os.getenv("DEFAULT_TRANSACTION_LIMIT", "10000000"))

config = Config()

# Database pool
db_pool: Optional[asyncpg.Pool] = None

async def get_db_pool() -> asyncpg.Pool:
    global db_pool
    if db_pool is None:
        db_pool = await asyncpg.create_pool(
            config.DATABASE_URL,
            min_size=5,
            max_size=20,
            command_timeout=60
        )
    return db_pool

@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await get_db_pool()
    await initialize_database(pool)
    logger.info("Participant Registry started")
    yield
    if db_pool:
        await db_pool.close()

app = FastAPI(
    title="Mojaloop Participant Registry (Production)",
    description="Production-ready participant registry with FSP management, credentials, and endpoints",
    version="2.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==================== Enums ====================

class ParticipantType(str, Enum):
    DFSP = "DFSP"  # Digital Financial Service Provider
    HUB = "HUB"
    PISP = "PISP"  # Payment Initiation Service Provider
    SWITCH = "SWITCH"

class ParticipantStatus(str, Enum):
    CREATED = "CREATED"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"

class EndpointType(str, Enum):
    FSPIOP_CALLBACK_URL_PARTIES_GET = "FSPIOP_CALLBACK_URL_PARTIES_GET"
    FSPIOP_CALLBACK_URL_PARTIES_PUT = "FSPIOP_CALLBACK_URL_PARTIES_PUT"
    FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR = "FSPIOP_CALLBACK_URL_PARTIES_PUT_ERROR"
    FSPIOP_CALLBACK_URL_QUOTES = "FSPIOP_CALLBACK_URL_QUOTES"
    FSPIOP_CALLBACK_URL_TRANSFER_POST = "FSPIOP_CALLBACK_URL_TRANSFER_POST"
    FSPIOP_CALLBACK_URL_TRANSFER_PUT = "FSPIOP_CALLBACK_URL_TRANSFER_PUT"
    FSPIOP_CALLBACK_URL_TRANSFER_ERROR = "FSPIOP_CALLBACK_URL_TRANSFER_ERROR"
    FSPIOP_CALLBACK_URL_BULK_TRANSFER_POST = "FSPIOP_CALLBACK_URL_BULK_TRANSFER_POST"
    FSPIOP_CALLBACK_URL_BULK_TRANSFER_PUT = "FSPIOP_CALLBACK_URL_BULK_TRANSFER_PUT"
    FSPIOP_CALLBACK_URL_BULK_TRANSFER_ERROR = "FSPIOP_CALLBACK_URL_BULK_TRANSFER_ERROR"
    SETTLEMENT_TRANSFER_POSITION_CHANGE_EMAIL = "SETTLEMENT_TRANSFER_POSITION_CHANGE_EMAIL"
    NET_DEBIT_CAP_THRESHOLD_BREACH_EMAIL = "NET_DEBIT_CAP_THRESHOLD_BREACH_EMAIL"

class CredentialType(str, Enum):
    API_KEY = "API_KEY"
    CERTIFICATE = "CERTIFICATE"
    OAUTH_CLIENT = "OAUTH_CLIENT"
    MTLS = "MTLS"

class CredentialStatus(str, Enum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"

# ==================== Models ====================

class ParticipantCreate(BaseModel):
    fsp_id: str = Field(..., min_length=1, max_length=255, description="Unique FSP identifier")
    name: str = Field(..., min_length=1, max_length=255)
    participant_type: ParticipantType = Field(default=ParticipantType.DFSP)
    currency: str = Field(default="NGN", max_length=3)
    description: Optional[str] = None
    
    # Contact information
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    
    # Limits (optional, uses defaults if not provided)
    net_debit_cap: Optional[Decimal] = None
    daily_limit: Optional[Decimal] = None
    transaction_limit: Optional[Decimal] = None
    
    # Metadata
    metadata: Optional[Dict[str, Any]] = {}
    
    @validator('fsp_id')
    def validate_fsp_id(cls, v):
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError("fsp_id must be alphanumeric with underscores/hyphens only")
        return v.lower()

class ParticipantUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    net_debit_cap: Optional[Decimal] = None
    daily_limit: Optional[Decimal] = None
    transaction_limit: Optional[Decimal] = None
    status: Optional[ParticipantStatus] = None
    metadata: Optional[Dict[str, Any]] = None

class ParticipantResponse(BaseModel):
    fsp_id: str
    name: str
    participant_type: ParticipantType
    currency: str
    status: ParticipantStatus
    description: Optional[str]
    contact_name: Optional[str]
    contact_email: Optional[str]
    contact_phone: Optional[str]
    net_debit_cap: Decimal
    daily_limit: Optional[Decimal]
    transaction_limit: Optional[Decimal]
    central_ledger_id: Optional[str]
    created_at: datetime
    updated_at: datetime
    approved_at: Optional[datetime]

class EndpointCreate(BaseModel):
    endpoint_type: EndpointType
    value: str = Field(..., description="URL or email address")
    is_active: bool = Field(default=True)
    
    @validator('value')
    def validate_value(cls, v, values):
        endpoint_type = values.get('endpoint_type')
        if endpoint_type and 'EMAIL' in endpoint_type:
            # Basic email validation
            if '@' not in v:
                raise ValueError("Invalid email address")
        else:
            # URL validation
            if not v.startswith(('http://', 'https://')):
                raise ValueError("URL must start with http:// or https://")
        return v

class EndpointResponse(BaseModel):
    id: int
    fsp_id: str
    endpoint_type: EndpointType
    value: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

class CredentialCreate(BaseModel):
    credential_type: CredentialType
    description: Optional[str] = None
    expires_in_days: Optional[int] = Field(default=365, ge=1, le=3650)

class CredentialResponse(BaseModel):
    id: int
    fsp_id: str
    credential_type: CredentialType
    credential_id: str  # Public identifier (API key prefix, cert fingerprint)
    status: CredentialStatus
    description: Optional[str]
    created_at: datetime
    expires_at: Optional[datetime]
    last_used_at: Optional[datetime]

class CredentialCreateResponse(CredentialResponse):
    secret: Optional[str] = None  # Only returned on creation (API key, client secret)

class OnboardingRequest(BaseModel):
    participant: ParticipantCreate
    endpoints: Optional[List[EndpointCreate]] = []
    create_api_key: bool = Field(default=True)

class OnboardingResponse(BaseModel):
    participant: ParticipantResponse
    endpoints: List[EndpointResponse]
    credentials: List[CredentialCreateResponse]
    central_ledger_status: str

# ==================== Database Schema ====================

async def initialize_database(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        await conn.execute("""
            -- Participants
            CREATE TABLE IF NOT EXISTS registry_participants (
                fsp_id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                participant_type VARCHAR(20) NOT NULL DEFAULT 'DFSP',
                currency VARCHAR(3) NOT NULL DEFAULT 'NGN',
                status VARCHAR(20) NOT NULL DEFAULT 'CREATED',
                description TEXT,
                contact_name VARCHAR(255),
                contact_email VARCHAR(255),
                contact_phone VARCHAR(50),
                net_debit_cap DECIMAL(18, 4) NOT NULL,
                daily_limit DECIMAL(18, 4),
                transaction_limit DECIMAL(18, 4),
                central_ledger_id VARCHAR(255),
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                approved_at TIMESTAMP WITH TIME ZONE
            );
            
            -- Endpoints
            CREATE TABLE IF NOT EXISTS participant_endpoints (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES registry_participants(fsp_id),
                endpoint_type VARCHAR(100) NOT NULL,
                value TEXT NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                UNIQUE(fsp_id, endpoint_type)
            );
            
            -- Credentials
            CREATE TABLE IF NOT EXISTS participant_credentials (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL REFERENCES registry_participants(fsp_id),
                credential_type VARCHAR(20) NOT NULL,
                credential_id VARCHAR(255) NOT NULL UNIQUE,
                credential_hash VARCHAR(255),
                status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                description TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                expires_at TIMESTAMP WITH TIME ZONE,
                last_used_at TIMESTAMP WITH TIME ZONE,
                revoked_at TIMESTAMP WITH TIME ZONE,
                metadata JSONB DEFAULT '{}'
            );
            
            -- Audit log
            CREATE TABLE IF NOT EXISTS participant_audit_log (
                id SERIAL PRIMARY KEY,
                fsp_id VARCHAR(255) NOT NULL,
                action VARCHAR(50) NOT NULL,
                actor VARCHAR(255),
                details JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            
            -- Indexes
            CREATE INDEX IF NOT EXISTS idx_participants_status ON registry_participants(status);
            CREATE INDEX IF NOT EXISTS idx_participants_type ON registry_participants(participant_type);
            CREATE INDEX IF NOT EXISTS idx_endpoints_fsp ON participant_endpoints(fsp_id);
            CREATE INDEX IF NOT EXISTS idx_credentials_fsp ON participant_credentials(fsp_id);
            CREATE INDEX IF NOT EXISTS idx_credentials_id ON participant_credentials(credential_id);
            CREATE INDEX IF NOT EXISTS idx_audit_fsp ON participant_audit_log(fsp_id);
        """)
        logger.info("Participant Registry database schema initialized")

# ==================== Central Ledger Client ====================

class CentralLedgerClient:
    """Client for Central Ledger integration"""
    
    def __init__(self, base_url: str):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
    
    async def create_participant(self, fsp_id: str, name: str, currency: str,
                                  net_debit_cap: Decimal, daily_limit: Optional[Decimal],
                                  transaction_limit: Optional[Decimal]) -> Dict[str, Any]:
        """Create participant in Central Ledger"""
        try:
            payload = {
                "fsp_id": fsp_id,
                "name": name,
                "currency": currency,
                "net_debit_cap": str(net_debit_cap),
                "daily_limit": str(daily_limit) if daily_limit else None,
                "transaction_limit": str(transaction_limit) if transaction_limit else None,
                "is_active": True
            }
            response = await self.client.post(f"{self.base_url}/participants", json=payload)
            if response.status_code == 200:
                return response.json()
            return {"error": response.text, "status_code": response.status_code}
        except Exception as e:
            logger.error(f"Central Ledger error: {e}")
            return {"error": str(e)}
    
    async def update_participant(self, fsp_id: str, updates: Dict) -> Dict[str, Any]:
        """Update participant in Central Ledger"""
        try:
            response = await self.client.patch(
                f"{self.base_url}/participants/{fsp_id}",
                json=updates
            )
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            return {"error": str(e)}
    
    async def get_participant(self, fsp_id: str) -> Dict[str, Any]:
        """Get participant from Central Ledger"""
        try:
            response = await self.client.get(f"{self.base_url}/participants/{fsp_id}")
            if response.status_code == 200:
                return response.json()
            return {"error": response.text}
        except Exception as e:
            return {"error": str(e)}

central_ledger = CentralLedgerClient(config.CENTRAL_LEDGER_URL)

# ==================== Credential Manager ====================

class CredentialManager:
    """Manages participant credentials"""
    
    @staticmethod
    def generate_api_key() -> tuple[str, str, str]:
        """Generate API key, returns (full_key, prefix, hash)"""
        prefix = secrets.token_hex(4)  # 8 char prefix
        secret = secrets.token_hex(24)  # 48 char secret
        full_key = f"{prefix}.{secret}"
        key_hash = hashlib.sha256(full_key.encode()).hexdigest()
        return full_key, prefix, key_hash
    
    @staticmethod
    def verify_api_key(api_key: str, stored_hash: str) -> bool:
        """Verify API key against stored hash"""
        key_hash = hashlib.sha256(api_key.encode()).hexdigest()
        return secrets.compare_digest(key_hash, stored_hash)
    
    @staticmethod
    def generate_certificate_fingerprint(cert_data: str) -> str:
        """Generate certificate fingerprint"""
        return hashlib.sha256(cert_data.encode()).hexdigest()[:32]

# ==================== Audit Logger ====================

async def log_audit(pool: asyncpg.Pool, fsp_id: str, action: str, 
                    actor: Optional[str] = None, details: Optional[Dict] = None):
    """Log audit event"""
    async with pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO participant_audit_log (fsp_id, action, actor, details)
            VALUES ($1, $2, $3, $4)
        """, fsp_id, action, actor, json.dumps(details or {}))

# ==================== API Endpoints ====================

@app.get("/health")
async def health_check():
    pool = await get_db_pool()
    db_healthy = False
    try:
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
            db_healthy = True
    except Exception as e:
        logger.error(f"Database health check failed: {e}")
    
    return {
        "status": "healthy" if db_healthy else "degraded",
        "service": "participant-registry",
        "version": "2.0.0",
        "database": "connected" if db_healthy else "disconnected",
        "central_ledger_url": config.CENTRAL_LEDGER_URL,
        "timestamp": datetime.utcnow().isoformat()
    }

# Participant Management
@app.post("/participants", response_model=ParticipantResponse)
async def create_participant(participant: ParticipantCreate):
    """Create a new participant (FSP)"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        # Check if exists
        existing = await conn.fetchrow(
            "SELECT fsp_id FROM registry_participants WHERE fsp_id = $1",
            participant.fsp_id
        )
        if existing:
            raise HTTPException(status_code=400, detail="Participant already exists")
        
        # Set defaults
        ndc = participant.net_debit_cap or config.DEFAULT_NDC
        daily = participant.daily_limit or config.DEFAULT_DAILY_LIMIT
        tx_limit = participant.transaction_limit or config.DEFAULT_TRANSACTION_LIMIT
        
        # Create in registry
        row = await conn.fetchrow("""
            INSERT INTO registry_participants 
            (fsp_id, name, participant_type, currency, status, description,
             contact_name, contact_email, contact_phone,
             net_debit_cap, daily_limit, transaction_limit, metadata)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *
        """, participant.fsp_id, participant.name, participant.participant_type.value,
            participant.currency, ParticipantStatus.CREATED.value, participant.description,
            participant.contact_name, participant.contact_email, participant.contact_phone,
            ndc, daily, tx_limit, json.dumps(participant.metadata or {}))
        
        await log_audit(pool, participant.fsp_id, "CREATED", details={
            "name": participant.name,
            "type": participant.participant_type.value
        })
        
        return ParticipantResponse(
            fsp_id=row['fsp_id'],
            name=row['name'],
            participant_type=ParticipantType(row['participant_type']),
            currency=row['currency'],
            status=ParticipantStatus(row['status']),
            description=row['description'],
            contact_name=row['contact_name'],
            contact_email=row['contact_email'],
            contact_phone=row['contact_phone'],
            net_debit_cap=row['net_debit_cap'],
            daily_limit=row['daily_limit'],
            transaction_limit=row['transaction_limit'],
            central_ledger_id=row['central_ledger_id'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            approved_at=row['approved_at']
        )

@app.get("/participants/{fsp_id}", response_model=ParticipantResponse)
async def get_participant(fsp_id: str):
    """Get participant details"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not row:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        return ParticipantResponse(
            fsp_id=row['fsp_id'],
            name=row['name'],
            participant_type=ParticipantType(row['participant_type']),
            currency=row['currency'],
            status=ParticipantStatus(row['status']),
            description=row['description'],
            contact_name=row['contact_name'],
            contact_email=row['contact_email'],
            contact_phone=row['contact_phone'],
            net_debit_cap=row['net_debit_cap'],
            daily_limit=row['daily_limit'],
            transaction_limit=row['transaction_limit'],
            central_ledger_id=row['central_ledger_id'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            approved_at=row['approved_at']
        )

@app.get("/participants")
async def list_participants(
    status: Optional[str] = None,
    participant_type: Optional[str] = None,
    currency: Optional[str] = None
):
    """List all participants"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        query = "SELECT * FROM registry_participants WHERE 1=1"
        params = []
        
        if status:
            params.append(status)
            query += f" AND status = ${len(params)}"
        if participant_type:
            params.append(participant_type)
            query += f" AND participant_type = ${len(params)}"
        if currency:
            params.append(currency)
            query += f" AND currency = ${len(params)}"
        
        query += " ORDER BY created_at DESC"
        rows = await conn.fetch(query, *params)
        
        return {
            "participants": [dict(row) for row in rows],
            "count": len(rows)
        }

@app.patch("/participants/{fsp_id}", response_model=ParticipantResponse)
async def update_participant(fsp_id: str, update: ParticipantUpdate):
    """Update participant details"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT * FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not existing:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        updates = []
        params = [fsp_id]
        
        if update.name is not None:
            params.append(update.name)
            updates.append(f"name = ${len(params)}")
        if update.description is not None:
            params.append(update.description)
            updates.append(f"description = ${len(params)}")
        if update.contact_name is not None:
            params.append(update.contact_name)
            updates.append(f"contact_name = ${len(params)}")
        if update.contact_email is not None:
            params.append(update.contact_email)
            updates.append(f"contact_email = ${len(params)}")
        if update.contact_phone is not None:
            params.append(update.contact_phone)
            updates.append(f"contact_phone = ${len(params)}")
        if update.net_debit_cap is not None:
            params.append(update.net_debit_cap)
            updates.append(f"net_debit_cap = ${len(params)}")
        if update.daily_limit is not None:
            params.append(update.daily_limit)
            updates.append(f"daily_limit = ${len(params)}")
        if update.transaction_limit is not None:
            params.append(update.transaction_limit)
            updates.append(f"transaction_limit = ${len(params)}")
        if update.status is not None:
            params.append(update.status.value)
            updates.append(f"status = ${len(params)}")
        if update.metadata is not None:
            params.append(json.dumps(update.metadata))
            updates.append(f"metadata = ${len(params)}")
        
        if updates:
            updates.append("updated_at = NOW()")
            query = f"UPDATE registry_participants SET {', '.join(updates)} WHERE fsp_id = $1 RETURNING *"
            row = await conn.fetchrow(query, *params)
            
            # Sync with Central Ledger if limits changed
            if any([update.net_debit_cap, update.daily_limit, update.transaction_limit, update.status]):
                cl_updates = {}
                if update.net_debit_cap:
                    cl_updates["net_debit_cap"] = str(update.net_debit_cap)
                if update.daily_limit:
                    cl_updates["daily_limit"] = str(update.daily_limit)
                if update.transaction_limit:
                    cl_updates["transaction_limit"] = str(update.transaction_limit)
                if update.status:
                    cl_updates["is_active"] = update.status == ParticipantStatus.ACTIVE
                
                if cl_updates:
                    await central_ledger.update_participant(fsp_id, cl_updates)
            
            await log_audit(pool, fsp_id, "UPDATED", details=update.dict(exclude_none=True))
        else:
            row = existing
        
        return ParticipantResponse(
            fsp_id=row['fsp_id'],
            name=row['name'],
            participant_type=ParticipantType(row['participant_type']),
            currency=row['currency'],
            status=ParticipantStatus(row['status']),
            description=row['description'],
            contact_name=row['contact_name'],
            contact_email=row['contact_email'],
            contact_phone=row['contact_phone'],
            net_debit_cap=row['net_debit_cap'],
            daily_limit=row['daily_limit'],
            transaction_limit=row['transaction_limit'],
            central_ledger_id=row['central_ledger_id'],
            created_at=row['created_at'],
            updated_at=row['updated_at'],
            approved_at=row['approved_at']
        )

@app.post("/participants/{fsp_id}/approve")
async def approve_participant(fsp_id: str):
    """Approve a participant and create in Central Ledger"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        if participant['status'] not in [ParticipantStatus.CREATED.value, ParticipantStatus.PENDING_APPROVAL.value]:
            raise HTTPException(status_code=400, detail=f"Cannot approve participant in {participant['status']} status")
        
        # Create in Central Ledger
        cl_result = await central_ledger.create_participant(
            fsp_id=fsp_id,
            name=participant['name'],
            currency=participant['currency'],
            net_debit_cap=participant['net_debit_cap'],
            daily_limit=participant['daily_limit'],
            transaction_limit=participant['transaction_limit']
        )
        
        if "error" in cl_result:
            logger.warning(f"Central Ledger creation failed: {cl_result['error']}")
            cl_status = "failed"
        else:
            cl_status = "created"
        
        # Update status
        await conn.execute("""
            UPDATE registry_participants 
            SET status = $2, approved_at = NOW(), central_ledger_id = $3, updated_at = NOW()
            WHERE fsp_id = $1
        """, fsp_id, ParticipantStatus.ACTIVE.value, cl_result.get('fsp_id'))
        
        await log_audit(pool, fsp_id, "APPROVED", details={"central_ledger_status": cl_status})
        
        return {
            "fsp_id": fsp_id,
            "status": ParticipantStatus.ACTIVE.value,
            "central_ledger_status": cl_status,
            "approved_at": datetime.utcnow().isoformat()
        }

@app.post("/participants/{fsp_id}/suspend")
async def suspend_participant(fsp_id: str, reason: Optional[str] = None):
    """Suspend a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        await conn.execute("""
            UPDATE registry_participants 
            SET status = $2, updated_at = NOW()
            WHERE fsp_id = $1
        """, fsp_id, ParticipantStatus.SUSPENDED.value)
        
        # Update Central Ledger
        await central_ledger.update_participant(fsp_id, {"is_active": False})
        
        await log_audit(pool, fsp_id, "SUSPENDED", details={"reason": reason})
        
        return {"fsp_id": fsp_id, "status": ParticipantStatus.SUSPENDED.value}

@app.post("/participants/{fsp_id}/reactivate")
async def reactivate_participant(fsp_id: str):
    """Reactivate a suspended participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        participant = await conn.fetchrow(
            "SELECT * FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        if participant['status'] != ParticipantStatus.SUSPENDED.value:
            raise HTTPException(status_code=400, detail="Participant is not suspended")
        
        await conn.execute("""
            UPDATE registry_participants 
            SET status = $2, updated_at = NOW()
            WHERE fsp_id = $1
        """, fsp_id, ParticipantStatus.ACTIVE.value)
        
        # Update Central Ledger
        await central_ledger.update_participant(fsp_id, {"is_active": True})
        
        await log_audit(pool, fsp_id, "REACTIVATED")
        
        return {"fsp_id": fsp_id, "status": ParticipantStatus.ACTIVE.value}

# Endpoint Management
@app.post("/participants/{fsp_id}/endpoints", response_model=EndpointResponse)
async def create_endpoint(fsp_id: str, endpoint: EndpointCreate):
    """Create or update an endpoint for a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        # Verify participant exists
        participant = await conn.fetchrow(
            "SELECT fsp_id FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        # Upsert endpoint
        row = await conn.fetchrow("""
            INSERT INTO participant_endpoints (fsp_id, endpoint_type, value, is_active)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (fsp_id, endpoint_type)
            DO UPDATE SET value = $3, is_active = $4, updated_at = NOW()
            RETURNING *
        """, fsp_id, endpoint.endpoint_type.value, endpoint.value, endpoint.is_active)
        
        await log_audit(pool, fsp_id, "ENDPOINT_UPDATED", details={
            "endpoint_type": endpoint.endpoint_type.value,
            "value": endpoint.value
        })
        
        return EndpointResponse(
            id=row['id'],
            fsp_id=row['fsp_id'],
            endpoint_type=EndpointType(row['endpoint_type']),
            value=row['value'],
            is_active=row['is_active'],
            created_at=row['created_at'],
            updated_at=row['updated_at']
        )

@app.get("/participants/{fsp_id}/endpoints")
async def list_endpoints(fsp_id: str):
    """List all endpoints for a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT * FROM participant_endpoints WHERE fsp_id = $1 ORDER BY endpoint_type",
            fsp_id
        )
        
        return {
            "endpoints": [
                {
                    "id": row['id'],
                    "endpoint_type": row['endpoint_type'],
                    "value": row['value'],
                    "is_active": row['is_active'],
                    "created_at": row['created_at'].isoformat(),
                    "updated_at": row['updated_at'].isoformat()
                }
                for row in rows
            ],
            "count": len(rows)
        }

@app.delete("/participants/{fsp_id}/endpoints/{endpoint_type}")
async def delete_endpoint(fsp_id: str, endpoint_type: str):
    """Delete an endpoint"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM participant_endpoints WHERE fsp_id = $1 AND endpoint_type = $2",
            fsp_id, endpoint_type
        )
        
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="Endpoint not found")
        
        await log_audit(pool, fsp_id, "ENDPOINT_DELETED", details={"endpoint_type": endpoint_type})
        
        return {"status": "deleted"}

# Credential Management
@app.post("/participants/{fsp_id}/credentials", response_model=CredentialCreateResponse)
async def create_credential(fsp_id: str, credential: CredentialCreate):
    """Create a new credential for a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        # Verify participant exists
        participant = await conn.fetchrow(
            "SELECT fsp_id FROM registry_participants WHERE fsp_id = $1",
            fsp_id
        )
        if not participant:
            raise HTTPException(status_code=404, detail="Participant not found")
        
        secret = None
        credential_id = None
        credential_hash = None
        
        if credential.credential_type == CredentialType.API_KEY:
            full_key, prefix, key_hash = CredentialManager.generate_api_key()
            credential_id = f"ak_{prefix}"
            credential_hash = key_hash
            secret = full_key
        elif credential.credential_type == CredentialType.OAUTH_CLIENT:
            client_id = f"client_{secrets.token_hex(8)}"
            client_secret = secrets.token_hex(32)
            credential_id = client_id
            credential_hash = hashlib.sha256(client_secret.encode()).hexdigest()
            secret = client_secret
        else:
            credential_id = f"cert_{secrets.token_hex(8)}"
        
        expires_at = None
        if credential.expires_in_days:
            expires_at = datetime.utcnow() + timedelta(days=credential.expires_in_days)
        
        row = await conn.fetchrow("""
            INSERT INTO participant_credentials 
            (fsp_id, credential_type, credential_id, credential_hash, status, description, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        """, fsp_id, credential.credential_type.value, credential_id, credential_hash,
            CredentialStatus.ACTIVE.value, credential.description, expires_at)
        
        await log_audit(pool, fsp_id, "CREDENTIAL_CREATED", details={
            "credential_type": credential.credential_type.value,
            "credential_id": credential_id
        })
        
        return CredentialCreateResponse(
            id=row['id'],
            fsp_id=row['fsp_id'],
            credential_type=CredentialType(row['credential_type']),
            credential_id=row['credential_id'],
            status=CredentialStatus(row['status']),
            description=row['description'],
            created_at=row['created_at'],
            expires_at=row['expires_at'],
            last_used_at=row['last_used_at'],
            secret=secret  # Only returned on creation
        )

@app.get("/participants/{fsp_id}/credentials")
async def list_credentials(fsp_id: str, include_revoked: bool = False):
    """List all credentials for a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        query = "SELECT * FROM participant_credentials WHERE fsp_id = $1"
        if not include_revoked:
            query += " AND status != 'REVOKED'"
        query += " ORDER BY created_at DESC"
        
        rows = await conn.fetch(query, fsp_id)
        
        return {
            "credentials": [
                {
                    "id": row['id'],
                    "credential_type": row['credential_type'],
                    "credential_id": row['credential_id'],
                    "status": row['status'],
                    "description": row['description'],
                    "created_at": row['created_at'].isoformat(),
                    "expires_at": row['expires_at'].isoformat() if row['expires_at'] else None,
                    "last_used_at": row['last_used_at'].isoformat() if row['last_used_at'] else None
                }
                for row in rows
            ],
            "count": len(rows)
        }

@app.post("/participants/{fsp_id}/credentials/{credential_id}/revoke")
async def revoke_credential(fsp_id: str, credential_id: str, reason: Optional[str] = None):
    """Revoke a credential"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        result = await conn.execute("""
            UPDATE participant_credentials 
            SET status = $3, revoked_at = NOW()
            WHERE fsp_id = $1 AND credential_id = $2 AND status = 'ACTIVE'
        """, fsp_id, credential_id, CredentialStatus.REVOKED.value)
        
        if result == "UPDATE 0":
            raise HTTPException(status_code=404, detail="Active credential not found")
        
        await log_audit(pool, fsp_id, "CREDENTIAL_REVOKED", details={
            "credential_id": credential_id,
            "reason": reason
        })
        
        return {"status": "revoked", "credential_id": credential_id}

# Credential Verification
@app.post("/credentials/verify")
async def verify_credential(api_key: str):
    """Verify an API key and return participant info"""
    pool = await get_db_pool()
    
    if not api_key or '.' not in api_key:
        raise HTTPException(status_code=401, detail="Invalid API key format")
    
    prefix = api_key.split('.')[0]
    credential_id = f"ak_{prefix}"
    
    async with pool.acquire() as conn:
        row = await conn.fetchrow("""
            SELECT c.*, p.fsp_id, p.name, p.status as participant_status
            FROM participant_credentials c
            JOIN registry_participants p ON c.fsp_id = p.fsp_id
            WHERE c.credential_id = $1 AND c.status = 'ACTIVE'
        """, credential_id)
        
        if not row:
            raise HTTPException(status_code=401, detail="Invalid or revoked credential")
        
        # Check expiration
        if row['expires_at'] and row['expires_at'] < datetime.utcnow():
            raise HTTPException(status_code=401, detail="Credential expired")
        
        # Verify hash
        if not CredentialManager.verify_api_key(api_key, row['credential_hash']):
            raise HTTPException(status_code=401, detail="Invalid API key")
        
        # Check participant status
        if row['participant_status'] != ParticipantStatus.ACTIVE.value:
            raise HTTPException(status_code=403, detail="Participant is not active")
        
        # Update last used
        await conn.execute("""
            UPDATE participant_credentials SET last_used_at = NOW()
            WHERE credential_id = $1
        """, credential_id)
        
        return {
            "valid": True,
            "fsp_id": row['fsp_id'],
            "name": row['name'],
            "credential_id": credential_id
        }

# Onboarding (Combined flow)
@app.post("/onboard", response_model=OnboardingResponse)
async def onboard_participant(request: OnboardingRequest):
    """Complete participant onboarding in one request"""
    pool = await get_db_pool()
    
    # Create participant
    participant_response = await create_participant(request.participant)
    
    # Create endpoints
    endpoint_responses = []
    for endpoint in request.endpoints:
        ep_response = await create_endpoint(request.participant.fsp_id, endpoint)
        endpoint_responses.append(ep_response)
    
    # Create API key if requested
    credential_responses = []
    if request.create_api_key:
        cred_request = CredentialCreate(
            credential_type=CredentialType.API_KEY,
            description="Auto-generated during onboarding"
        )
        cred_response = await create_credential(request.participant.fsp_id, cred_request)
        credential_responses.append(cred_response)
    
    # Auto-approve and create in Central Ledger
    approval_result = await approve_participant(request.participant.fsp_id)
    
    return OnboardingResponse(
        participant=participant_response,
        endpoints=endpoint_responses,
        credentials=credential_responses,
        central_ledger_status=approval_result.get("central_ledger_status", "unknown")
    )

# Audit Log
@app.get("/participants/{fsp_id}/audit")
async def get_audit_log(fsp_id: str, limit: int = 100):
    """Get audit log for a participant"""
    pool = await get_db_pool()
    
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT * FROM participant_audit_log 
            WHERE fsp_id = $1 
            ORDER BY created_at DESC 
            LIMIT $2
        """, fsp_id, limit)
        
        return {
            "audit_log": [
                {
                    "id": row['id'],
                    "action": row['action'],
                    "actor": row['actor'],
                    "details": row['details'],
                    "created_at": row['created_at'].isoformat()
                }
                for row in rows
            ],
            "count": len(rows)
        }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8003)
