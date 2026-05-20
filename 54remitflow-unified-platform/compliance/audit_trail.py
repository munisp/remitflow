"""
Compliance and Audit Trail Service
Immutable audit logging, data classification, PII handling, and consent tracking
"""

import os
import json
import logging
import hashlib
import asyncio
from typing import Optional, Dict, Any, List, Set
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from enum import Enum
import uuid

import asyncpg
import redis.asyncio as redis
from aiokafka import AIOKafkaProducer

logger = logging.getLogger(__name__)


class DataClassification(str, Enum):
    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    RESTRICTED = "restricted"  # PII, financial data
    SECRET = "secret"  # Encryption keys, credentials


class PIIType(str, Enum):
    NAME = "name"
    PHONE = "phone"
    EMAIL = "email"
    ADDRESS = "address"
    BVN = "bvn"
    NIN = "nin"
    DATE_OF_BIRTH = "date_of_birth"
    ACCOUNT_NUMBER = "account_number"
    CARD_NUMBER = "card_number"
    PIN = "pin"
    BIOMETRIC = "biometric"


class ConsentType(str, Enum):
    DATA_PROCESSING = "data_processing"
    MARKETING = "marketing"
    THIRD_PARTY_SHARING = "third_party_sharing"
    CROSS_BORDER_TRANSFER = "cross_border_transfer"
    BIOMETRIC_COLLECTION = "biometric_collection"
    LOCATION_TRACKING = "location_tracking"


class ConsentStatus(str, Enum):
    GRANTED = "granted"
    DENIED = "denied"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"


class AuditEventType(str, Enum):
    # Authentication
    LOGIN_SUCCESS = "login_success"
    LOGIN_FAILURE = "login_failure"
    LOGOUT = "logout"
    PASSWORD_CHANGE = "password_change"
    MFA_ENABLED = "mfa_enabled"
    MFA_DISABLED = "mfa_disabled"
    
    # Authorization
    PERMISSION_GRANTED = "permission_granted"
    PERMISSION_DENIED = "permission_denied"
    ROLE_ASSIGNED = "role_assigned"
    ROLE_REMOVED = "role_removed"
    
    # Financial
    TRANSACTION_INITIATED = "transaction_initiated"
    TRANSACTION_COMPLETED = "transaction_completed"
    TRANSACTION_FAILED = "transaction_failed"
    TRANSACTION_REVERSED = "transaction_reversed"
    BALANCE_INQUIRY = "balance_inquiry"
    
    # Account
    ACCOUNT_CREATED = "account_created"
    ACCOUNT_UPDATED = "account_updated"
    ACCOUNT_SUSPENDED = "account_suspended"
    ACCOUNT_CLOSED = "account_closed"
    
    # KYC
    KYC_SUBMITTED = "kyc_submitted"
    KYC_APPROVED = "kyc_approved"
    KYC_REJECTED = "kyc_rejected"
    KYC_DOCUMENT_UPLOADED = "kyc_document_uploaded"
    
    # Data Access
    DATA_ACCESSED = "data_accessed"
    DATA_EXPORTED = "data_exported"
    DATA_DELETED = "data_deleted"
    PII_ACCESSED = "pii_accessed"
    
    # System
    CONFIG_CHANGED = "config_changed"
    SYSTEM_ERROR = "system_error"
    SECURITY_ALERT = "security_alert"


@dataclass
class AuditEvent:
    """Immutable audit event"""
    event_id: str
    event_type: AuditEventType
    timestamp: datetime
    
    # Actor
    actor_id: str
    actor_type: str  # user, agent, system, service
    actor_ip: Optional[str] = None
    actor_device: Optional[str] = None
    
    # Target
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    
    # Action details
    action: str = ""
    result: str = "success"  # success, failure, partial
    
    # Data
    old_value: Optional[Dict[str, Any]] = None
    new_value: Optional[Dict[str, Any]] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    # Classification
    data_classification: DataClassification = DataClassification.INTERNAL
    contains_pii: bool = False
    pii_types: List[PIIType] = field(default_factory=list)
    
    # Chain
    sequence_number: int = 0
    previous_hash: str = ""
    event_hash: str = ""
    
    def compute_hash(self) -> str:
        """Compute cryptographic hash for this event"""
        data = {
            "event_id": self.event_id,
            "event_type": self.event_type.value,
            "timestamp": self.timestamp.isoformat(),
            "actor_id": self.actor_id,
            "actor_type": self.actor_type,
            "target_type": self.target_type,
            "target_id": self.target_id,
            "action": self.action,
            "result": self.result,
            "sequence_number": self.sequence_number,
            "previous_hash": self.previous_hash
        }
        return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


@dataclass
class ConsentRecord:
    """Record of user consent"""
    consent_id: str
    user_id: str
    consent_type: ConsentType
    status: ConsentStatus
    
    # Details
    version: str = "1.0"
    purpose: str = ""
    data_categories: List[str] = field(default_factory=list)
    
    # Timestamps
    granted_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    withdrawn_at: Optional[datetime] = None
    
    # Metadata
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    consent_text_hash: Optional[str] = None


@dataclass
class RetentionPolicy:
    """Data retention policy"""
    policy_id: str
    data_type: str
    classification: DataClassification
    
    # Retention periods
    retention_days: int
    archive_after_days: Optional[int] = None
    delete_after_days: Optional[int] = None
    
    # Legal basis
    legal_basis: str = ""
    regulation: str = ""  # NDPR, GDPR, etc.
    
    # Actions
    anonymize_on_archive: bool = False
    notify_before_delete: bool = True


class PIIMasker:
    """Masks PII data for logging and display"""
    
    @staticmethod
    def mask_phone(phone: str) -> str:
        """Mask phone number: +234****5678"""
        if len(phone) < 4:
            return "****"
        return phone[:4] + "****" + phone[-4:]
    
    @staticmethod
    def mask_email(email: str) -> str:
        """Mask email: j***@example.com"""
        if "@" not in email:
            return "****"
        local, domain = email.split("@", 1)
        if len(local) <= 1:
            return f"*@{domain}"
        return f"{local[0]}***@{domain}"
    
    @staticmethod
    def mask_bvn(bvn: str) -> str:
        """Mask BVN: ****5678"""
        if len(bvn) < 4:
            return "****"
        return "****" + bvn[-4:]
    
    @staticmethod
    def mask_account_number(account: str) -> str:
        """Mask account: ****5678"""
        if len(account) < 4:
            return "****"
        return "****" + account[-4:]
    
    @staticmethod
    def mask_name(name: str) -> str:
        """Mask name: J*** D***"""
        parts = name.split()
        masked = []
        for part in parts:
            if len(part) <= 1:
                masked.append("*")
            else:
                masked.append(part[0] + "***")
        return " ".join(masked)
    
    @classmethod
    def mask_dict(cls, data: Dict[str, Any], pii_fields: Set[str]) -> Dict[str, Any]:
        """Mask PII fields in a dictionary"""
        masked = {}
        for key, value in data.items():
            if key in pii_fields:
                if "phone" in key.lower():
                    masked[key] = cls.mask_phone(str(value))
                elif "email" in key.lower():
                    masked[key] = cls.mask_email(str(value))
                elif "bvn" in key.lower() or "nin" in key.lower():
                    masked[key] = cls.mask_bvn(str(value))
                elif "account" in key.lower():
                    masked[key] = cls.mask_account_number(str(value))
                elif "name" in key.lower():
                    masked[key] = cls.mask_name(str(value))
                else:
                    masked[key] = "****"
            elif isinstance(value, dict):
                masked[key] = cls.mask_dict(value, pii_fields)
            else:
                masked[key] = value
        return masked


class AuditTrailService:
    """
    Comprehensive audit trail service for compliance.
    Provides immutable logging with cryptographic chaining.
    """
    
    def __init__(self):
        self.db_url = os.getenv(
            "DATABASE_URL",
            "postgresql://postgres:postgres@postgres.remittance.svc.cluster.local:5432/multibank"
        )
        self.redis_url = os.getenv(
            "REDIS_URL",
            "redis://redis.remittance.svc.cluster.local:6379"
        )
        self.kafka_bootstrap = os.getenv(
            "KAFKA_BOOTSTRAP_SERVERS",
            "kafka.remittance.svc.cluster.local:9092"
        )
        
        self.db_pool: Optional[asyncpg.Pool] = None
        self.redis_client: Optional[redis.Redis] = None
        self.kafka_producer: Optional[AIOKafkaProducer] = None
        
        self._last_hash = ""
        self._sequence = 0
        
        # PII fields to mask in logs
        self.pii_fields = {
            "phone", "phone_number", "email", "bvn", "nin",
            "account_number", "card_number", "pin", "password",
            "first_name", "last_name", "full_name", "name",
            "address", "date_of_birth", "dob"
        }
    
    async def initialize(self):
        """Initialize connections"""
        self.db_pool = await asyncpg.create_pool(self.db_url, min_size=2, max_size=10)
        self.redis_client = redis.from_url(self.redis_url)
        self.kafka_producer = AIOKafkaProducer(
            bootstrap_servers=self.kafka_bootstrap,
            value_serializer=lambda v: json.dumps(v, default=str).encode()
        )
        await self.kafka_producer.start()
        await self._init_schema()
        await self._load_chain_state()
    
    async def _init_schema(self):
        """Initialize database schema"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_events (
                    event_id TEXT PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    timestamp TIMESTAMPTZ NOT NULL,
                    actor_id TEXT NOT NULL,
                    actor_type TEXT NOT NULL,
                    actor_ip TEXT,
                    actor_device TEXT,
                    target_type TEXT,
                    target_id TEXT,
                    action TEXT,
                    result TEXT,
                    old_value JSONB,
                    new_value JSONB,
                    metadata JSONB DEFAULT '{}',
                    data_classification TEXT,
                    contains_pii BOOLEAN DEFAULT FALSE,
                    pii_types TEXT[],
                    sequence_number BIGINT NOT NULL UNIQUE,
                    previous_hash TEXT NOT NULL,
                    event_hash TEXT NOT NULL,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS consent_records (
                    consent_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    consent_type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    version TEXT,
                    purpose TEXT,
                    data_categories TEXT[],
                    granted_at TIMESTAMPTZ,
                    expires_at TIMESTAMPTZ,
                    withdrawn_at TIMESTAMPTZ,
                    ip_address TEXT,
                    user_agent TEXT,
                    consent_text_hash TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS retention_policies (
                    policy_id TEXT PRIMARY KEY,
                    data_type TEXT NOT NULL,
                    classification TEXT NOT NULL,
                    retention_days INTEGER NOT NULL,
                    archive_after_days INTEGER,
                    delete_after_days INTEGER,
                    legal_basis TEXT,
                    regulation TEXT,
                    anonymize_on_archive BOOLEAN DEFAULT FALSE,
                    notify_before_delete BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_events(target_type, target_id, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_events(event_type, timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_sequence ON audit_events(sequence_number);
                CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_records(user_id, consent_type);
            """)
    
    async def _load_chain_state(self):
        """Load last audit chain state"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT sequence_number, event_hash
                FROM audit_events
                ORDER BY sequence_number DESC
                LIMIT 1
            """)
            if row:
                self._sequence = row["sequence_number"]
                self._last_hash = row["event_hash"]
    
    async def log_event(
        self,
        event_type: AuditEventType,
        actor_id: str,
        actor_type: str,
        action: str,
        result: str = "success",
        target_type: str = None,
        target_id: str = None,
        old_value: Dict[str, Any] = None,
        new_value: Dict[str, Any] = None,
        metadata: Dict[str, Any] = None,
        actor_ip: str = None,
        actor_device: str = None,
        data_classification: DataClassification = DataClassification.INTERNAL,
        pii_types: List[PIIType] = None
    ) -> AuditEvent:
        """Log an audit event"""
        self._sequence += 1
        
        # Mask PII in values
        masked_old = PIIMasker.mask_dict(old_value, self.pii_fields) if old_value else None
        masked_new = PIIMasker.mask_dict(new_value, self.pii_fields) if new_value else None
        
        event = AuditEvent(
            event_id=f"audit-{uuid.uuid4().hex}",
            event_type=event_type,
            timestamp=datetime.now(timezone.utc),
            actor_id=actor_id,
            actor_type=actor_type,
            actor_ip=actor_ip,
            actor_device=actor_device,
            target_type=target_type,
            target_id=target_id,
            action=action,
            result=result,
            old_value=masked_old,
            new_value=masked_new,
            metadata=metadata or {},
            data_classification=data_classification,
            contains_pii=bool(pii_types),
            pii_types=pii_types or [],
            sequence_number=self._sequence,
            previous_hash=self._last_hash
        )
        
        event.event_hash = event.compute_hash()
        self._last_hash = event.event_hash
        
        # Save to database
        await self._save_event(event)
        
        # Publish to Kafka for real-time processing
        await self.kafka_producer.send(
            "audit.events",
            value=self._event_to_dict(event)
        )
        
        return event
    
    async def _save_event(self, event: AuditEvent):
        """Save event to database"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO audit_events (
                    event_id, event_type, timestamp,
                    actor_id, actor_type, actor_ip, actor_device,
                    target_type, target_id, action, result,
                    old_value, new_value, metadata,
                    data_classification, contains_pii, pii_types,
                    sequence_number, previous_hash, event_hash
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
            """, event.event_id, event.event_type.value, event.timestamp,
                event.actor_id, event.actor_type, event.actor_ip, event.actor_device,
                event.target_type, event.target_id, event.action, event.result,
                json.dumps(event.old_value) if event.old_value else None,
                json.dumps(event.new_value) if event.new_value else None,
                json.dumps(event.metadata),
                event.data_classification.value, event.contains_pii,
                [p.value for p in event.pii_types],
                event.sequence_number, event.previous_hash, event.event_hash)
    
    def _event_to_dict(self, event: AuditEvent) -> Dict[str, Any]:
        """Convert event to dictionary"""
        return {
            "event_id": event.event_id,
            "event_type": event.event_type.value,
            "timestamp": event.timestamp.isoformat(),
            "actor_id": event.actor_id,
            "actor_type": event.actor_type,
            "target_type": event.target_type,
            "target_id": event.target_id,
            "action": event.action,
            "result": event.result,
            "data_classification": event.data_classification.value,
            "contains_pii": event.contains_pii
        }
    
    async def verify_chain_integrity(self) -> tuple[bool, Optional[str]]:
        """Verify the integrity of the audit chain"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT * FROM audit_events
                ORDER BY sequence_number ASC
            """)
            
            previous_hash = ""
            for row in rows:
                # Verify chain continuity
                if row["previous_hash"] != previous_hash:
                    return False, f"Chain broken at sequence {row['sequence_number']}"
                
                # Verify hash
                event = AuditEvent(
                    event_id=row["event_id"],
                    event_type=AuditEventType(row["event_type"]),
                    timestamp=row["timestamp"],
                    actor_id=row["actor_id"],
                    actor_type=row["actor_type"],
                    target_type=row["target_type"],
                    target_id=row["target_id"],
                    action=row["action"],
                    result=row["result"],
                    sequence_number=row["sequence_number"],
                    previous_hash=row["previous_hash"]
                )
                
                computed_hash = event.compute_hash()
                if computed_hash != row["event_hash"]:
                    return False, f"Hash mismatch at sequence {row['sequence_number']}"
                
                previous_hash = row["event_hash"]
            
            return True, None
    
    async def record_consent(
        self,
        user_id: str,
        consent_type: ConsentType,
        status: ConsentStatus,
        purpose: str,
        data_categories: List[str] = None,
        expires_at: datetime = None,
        ip_address: str = None,
        user_agent: str = None,
        consent_text: str = None
    ) -> ConsentRecord:
        """Record user consent"""
        consent = ConsentRecord(
            consent_id=f"consent-{uuid.uuid4().hex}",
            user_id=user_id,
            consent_type=consent_type,
            status=status,
            purpose=purpose,
            data_categories=data_categories or [],
            granted_at=datetime.now(timezone.utc) if status == ConsentStatus.GRANTED else None,
            expires_at=expires_at,
            ip_address=ip_address,
            user_agent=user_agent,
            consent_text_hash=hashlib.sha256(consent_text.encode()).hexdigest() if consent_text else None
        )
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO consent_records (
                    consent_id, user_id, consent_type, status,
                    purpose, data_categories, granted_at, expires_at,
                    ip_address, user_agent, consent_text_hash
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            """, consent.consent_id, consent.user_id, consent.consent_type.value,
                consent.status.value, consent.purpose, consent.data_categories,
                consent.granted_at, consent.expires_at, consent.ip_address,
                consent.user_agent, consent.consent_text_hash)
        
        # Log audit event
        await self.log_event(
            event_type=AuditEventType.DATA_ACCESSED,
            actor_id=user_id,
            actor_type="user",
            action=f"consent_{status.value}",
            target_type="consent",
            target_id=consent.consent_id,
            new_value={"consent_type": consent_type.value, "status": status.value}
        )
        
        return consent
    
    async def check_consent(
        self,
        user_id: str,
        consent_type: ConsentType
    ) -> bool:
        """Check if user has valid consent"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT status, expires_at
                FROM consent_records
                WHERE user_id = $1 AND consent_type = $2
                ORDER BY granted_at DESC
                LIMIT 1
            """, user_id, consent_type.value)
            
            if not row:
                return False
            
            if row["status"] != ConsentStatus.GRANTED.value:
                return False
            
            if row["expires_at"] and row["expires_at"] < datetime.now(timezone.utc):
                return False
            
            return True
    
    async def withdraw_consent(
        self,
        user_id: str,
        consent_type: ConsentType
    ) -> bool:
        """Withdraw user consent"""
        async with self.db_pool.acquire() as conn:
            result = await conn.execute("""
                UPDATE consent_records
                SET status = $1, withdrawn_at = $2, updated_at = $2
                WHERE user_id = $3 AND consent_type = $4 AND status = $5
            """, ConsentStatus.WITHDRAWN.value, datetime.now(timezone.utc),
                user_id, consent_type.value, ConsentStatus.GRANTED.value)
            
            if result == "UPDATE 0":
                return False
            
            # Log audit event
            await self.log_event(
                event_type=AuditEventType.DATA_ACCESSED,
                actor_id=user_id,
                actor_type="user",
                action="consent_withdrawn",
                target_type="consent",
                metadata={"consent_type": consent_type.value}
            )
            
            return True
    
    async def get_audit_trail(
        self,
        actor_id: str = None,
        target_type: str = None,
        target_id: str = None,
        event_types: List[AuditEventType] = None,
        start_date: datetime = None,
        end_date: datetime = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get audit trail with filters"""
        conditions = []
        params = []
        param_idx = 1
        
        if actor_id:
            conditions.append(f"actor_id = ${param_idx}")
            params.append(actor_id)
            param_idx += 1
        
        if target_type:
            conditions.append(f"target_type = ${param_idx}")
            params.append(target_type)
            param_idx += 1
        
        if target_id:
            conditions.append(f"target_id = ${param_idx}")
            params.append(target_id)
            param_idx += 1
        
        if event_types:
            conditions.append(f"event_type = ANY(${param_idx})")
            params.append([e.value for e in event_types])
            param_idx += 1
        
        if start_date:
            conditions.append(f"timestamp >= ${param_idx}")
            params.append(start_date)
            param_idx += 1
        
        if end_date:
            conditions.append(f"timestamp <= ${param_idx}")
            params.append(end_date)
            param_idx += 1
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch(f"""
                SELECT * FROM audit_events
                WHERE {where_clause}
                ORDER BY timestamp DESC
                LIMIT {limit}
            """, *params)
            
            return [dict(row) for row in rows]


# Global instance
_audit_service: Optional[AuditTrailService] = None


async def get_audit_service() -> AuditTrailService:
    """Get or create audit service"""
    global _audit_service
    if _audit_service is None:
        _audit_service = AuditTrailService()
        await _audit_service.initialize()
    return _audit_service
