"""
Immutable Audit Logging System
Append-only, tamper-evident audit logs for all money movement and KYC actions
"""

import os
import json
import time
import hashlib
import logging
import asyncio
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4
import asyncpg
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)


class AuditEventType(str, Enum):
    # Money movement events
    TRANSACTION_INITIATED = "transaction.initiated"
    TRANSACTION_COMPLETED = "transaction.completed"
    TRANSACTION_FAILED = "transaction.failed"
    TRANSACTION_REVERSED = "transaction.reversed"
    TRANSFER_INITIATED = "transfer.initiated"
    TRANSFER_COMPLETED = "transfer.completed"
    SETTLEMENT_INITIATED = "settlement.initiated"
    SETTLEMENT_COMPLETED = "settlement.completed"
    
    # KYC events
    KYC_INITIATED = "kyc.initiated"
    KYC_DOCUMENT_UPLOADED = "kyc.document_uploaded"
    KYC_VERIFICATION_STARTED = "kyc.verification_started"
    KYC_VERIFICATION_COMPLETED = "kyc.verification_completed"
    KYC_APPROVED = "kyc.approved"
    KYC_REJECTED = "kyc.rejected"
    KYC_OVERRIDE = "kyc.override"
    
    # Agent events
    AGENT_CREATED = "agent.created"
    AGENT_ACTIVATED = "agent.activated"
    AGENT_SUSPENDED = "agent.suspended"
    AGENT_TIER_CHANGED = "agent.tier_changed"
    AGENT_LIMIT_CHANGED = "agent.limit_changed"
    
    # Authentication events
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_FAILED = "auth.failed"
    AUTH_MFA_ENABLED = "auth.mfa_enabled"
    AUTH_PASSWORD_CHANGED = "auth.password_changed"
    
    # Admin events
    ADMIN_ACTION = "admin.action"
    ADMIN_OVERRIDE = "admin.override"
    CONFIG_CHANGED = "config.changed"
    PERMISSION_GRANTED = "permission.granted"
    PERMISSION_REVOKED = "permission.revoked"
    
    # System events
    SYSTEM_ERROR = "system.error"
    SYSTEM_ALERT = "system.alert"


class AuditSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


@dataclass
class AuditEvent:
    """Immutable audit event"""
    event_id: str
    event_type: AuditEventType
    timestamp: str
    severity: AuditSeverity
    
    # Actor information
    actor_id: str
    actor_type: str  # user, agent, system, admin
    actor_ip: Optional[str] = None
    actor_device: Optional[str] = None
    
    # Resource information
    resource_type: str = ""
    resource_id: str = ""
    
    # Event details
    action: str = ""
    description: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    
    # Context
    tenant_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None
    correlation_id: Optional[str] = None
    
    # Integrity
    previous_hash: Optional[str] = None
    event_hash: Optional[str] = None
    signature: Optional[str] = None
    
    # Retention
    retention_days: int = 2555  # 7 years default for financial records
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)
    
    def compute_hash(self) -> str:
        """Compute hash of event for integrity verification"""
        data = {
            "event_id": self.event_id,
            "event_type": self.event_type,
            "timestamp": self.timestamp,
            "actor_id": self.actor_id,
            "resource_id": self.resource_id,
            "action": self.action,
            "details": self.details,
            "previous_hash": self.previous_hash
        }
        content = json.dumps(data, sort_keys=True)
        return hashlib.sha256(content.encode()).hexdigest()


class AuditLogStore:
    """PostgreSQL-based append-only audit log store"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or os.getenv(
            "AUDIT_DATABASE_URL",
            "postgresql://postgres:postgres@localhost:5432/audit_logs"
        )
        self._pool: Optional[asyncpg.Pool] = None
        self._last_hash: Optional[str] = None
        self._signing_key: Optional[rsa.RSAPrivateKey] = None
        self._init_signing_key()
    
    def _init_signing_key(self):
        """Initialize signing key for audit log signatures"""
        key_path = os.getenv("AUDIT_SIGNING_KEY_PATH")
        if key_path and os.path.exists(key_path):
            with open(key_path, "rb") as f:
                self._signing_key = serialization.load_pem_private_key(
                    f.read(),
                    password=os.getenv("AUDIT_SIGNING_KEY_PASSWORD", "").encode() or None,
                    backend=default_backend()
                )
        else:
            # Generate ephemeral key for development
            self._signing_key = rsa.generate_private_key(
                public_exponent=65537,
                key_size=2048,
                backend=default_backend()
            )
    
    async def connect(self):
        """Connect to database"""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                self.database_url,
                min_size=2,
                max_size=10
            )
            await self._ensure_schema()
            await self._load_last_hash()
    
    async def _ensure_schema(self):
        """Ensure audit log schema exists"""
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS audit_logs (
                    id BIGSERIAL PRIMARY KEY,
                    event_id UUID UNIQUE NOT NULL,
                    event_type VARCHAR(100) NOT NULL,
                    timestamp TIMESTAMPTZ NOT NULL,
                    severity VARCHAR(20) NOT NULL,
                    
                    actor_id VARCHAR(255) NOT NULL,
                    actor_type VARCHAR(50) NOT NULL,
                    actor_ip INET,
                    actor_device TEXT,
                    
                    resource_type VARCHAR(100),
                    resource_id VARCHAR(255),
                    
                    action VARCHAR(255),
                    description TEXT,
                    details JSONB,
                    
                    tenant_id VARCHAR(100),
                    session_id VARCHAR(255),
                    request_id VARCHAR(255),
                    correlation_id VARCHAR(255),
                    
                    previous_hash VARCHAR(64),
                    event_hash VARCHAR(64) NOT NULL,
                    signature TEXT,
                    
                    retention_days INTEGER DEFAULT 2555,
                    
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                -- Indexes for common queries
                CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id);
                CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation ON audit_logs(correlation_id);
                
                -- Prevent updates and deletes (append-only)
                CREATE OR REPLACE FUNCTION prevent_audit_modification()
                RETURNS TRIGGER AS $$
                BEGIN
                    RAISE EXCEPTION 'Audit logs are immutable and cannot be modified or deleted';
                END;
                $$ LANGUAGE plpgsql;
                
                DROP TRIGGER IF EXISTS prevent_audit_update ON audit_logs;
                CREATE TRIGGER prevent_audit_update
                    BEFORE UPDATE ON audit_logs
                    FOR EACH ROW
                    EXECUTE FUNCTION prevent_audit_modification();
                
                DROP TRIGGER IF EXISTS prevent_audit_delete ON audit_logs;
                CREATE TRIGGER prevent_audit_delete
                    BEFORE DELETE ON audit_logs
                    FOR EACH ROW
                    EXECUTE FUNCTION prevent_audit_modification();
            """)
    
    async def _load_last_hash(self):
        """Load the hash of the last audit event"""
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT event_hash FROM audit_logs ORDER BY id DESC LIMIT 1"
            )
            if row:
                self._last_hash = row["event_hash"]
    
    def _sign_event(self, event_hash: str) -> str:
        """Sign an event hash"""
        if self._signing_key is None:
            return ""
        
        signature = self._signing_key.sign(
            event_hash.encode(),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
        return signature.hex()
    
    async def append(self, event: AuditEvent) -> str:
        """Append an audit event (immutable)"""
        await self.connect()
        
        # Set previous hash for chain integrity
        event.previous_hash = self._last_hash
        
        # Compute event hash
        event.event_hash = event.compute_hash()
        
        # Sign the event
        event.signature = self._sign_event(event.event_hash)
        
        async with self._pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO audit_logs (
                    event_id, event_type, timestamp, severity,
                    actor_id, actor_type, actor_ip, actor_device,
                    resource_type, resource_id,
                    action, description, details,
                    tenant_id, session_id, request_id, correlation_id,
                    previous_hash, event_hash, signature,
                    retention_days
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6, $7, $8,
                    $9, $10,
                    $11, $12, $13,
                    $14, $15, $16, $17,
                    $18, $19, $20,
                    $21
                )
            """,
                event.event_id,
                event.event_type,
                event.timestamp,
                event.severity,
                event.actor_id,
                event.actor_type,
                event.actor_ip,
                event.actor_device,
                event.resource_type,
                event.resource_id,
                event.action,
                event.description,
                json.dumps(event.details),
                event.tenant_id,
                event.session_id,
                event.request_id,
                event.correlation_id,
                event.previous_hash,
                event.event_hash,
                event.signature,
                event.retention_days
            )
        
        # Update last hash
        self._last_hash = event.event_hash
        
        logger.info(f"Audit event logged: {event.event_type} - {event.event_id}")
        return event.event_id
    
    async def query(
        self,
        event_type: Optional[str] = None,
        actor_id: Optional[str] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        tenant_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """Query audit logs"""
        await self.connect()
        
        conditions = []
        params = []
        param_idx = 1
        
        if event_type:
            conditions.append(f"event_type = ${param_idx}")
            params.append(event_type)
            param_idx += 1
        
        if actor_id:
            conditions.append(f"actor_id = ${param_idx}")
            params.append(actor_id)
            param_idx += 1
        
        if resource_type:
            conditions.append(f"resource_type = ${param_idx}")
            params.append(resource_type)
            param_idx += 1
        
        if resource_id:
            conditions.append(f"resource_id = ${param_idx}")
            params.append(resource_id)
            param_idx += 1
        
        if start_time:
            conditions.append(f"timestamp >= ${param_idx}")
            params.append(start_time)
            param_idx += 1
        
        if end_time:
            conditions.append(f"timestamp <= ${param_idx}")
            params.append(end_time)
            param_idx += 1
        
        if tenant_id:
            conditions.append(f"tenant_id = ${param_idx}")
            params.append(tenant_id)
            param_idx += 1
        
        if correlation_id:
            conditions.append(f"correlation_id = ${param_idx}")
            params.append(correlation_id)
            param_idx += 1
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        query = f"""
            SELECT * FROM audit_logs
            WHERE {where_clause}
            ORDER BY timestamp DESC
            LIMIT ${param_idx} OFFSET ${param_idx + 1}
        """
        params.extend([limit, offset])
        
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
    
    async def verify_chain_integrity(
        self,
        start_id: Optional[int] = None,
        end_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """Verify the integrity of the audit log chain"""
        await self.connect()
        
        conditions = []
        params = []
        
        if start_id:
            conditions.append(f"id >= $1")
            params.append(start_id)
        
        if end_id:
            conditions.append(f"id <= ${len(params) + 1}")
            params.append(end_id)
        
        where_clause = " AND ".join(conditions) if conditions else "1=1"
        
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(f"""
                SELECT id, event_id, event_hash, previous_hash, details, timestamp
                FROM audit_logs
                WHERE {where_clause}
                ORDER BY id ASC
            """, *params)
        
        if not rows:
            return {"valid": True, "checked": 0, "errors": []}
        
        errors = []
        previous_hash = None
        
        for row in rows:
            # Verify chain linkage
            if previous_hash is not None and row["previous_hash"] != previous_hash:
                errors.append({
                    "id": row["id"],
                    "event_id": str(row["event_id"]),
                    "error": "Chain broken - previous_hash mismatch",
                    "expected": previous_hash,
                    "actual": row["previous_hash"]
                })
            
            previous_hash = row["event_hash"]
        
        return {
            "valid": len(errors) == 0,
            "checked": len(rows),
            "errors": errors,
            "first_id": rows[0]["id"] if rows else None,
            "last_id": rows[-1]["id"] if rows else None
        }
    
    async def export_for_compliance(
        self,
        start_time: datetime,
        end_time: datetime,
        tenant_id: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Export audit logs for compliance reporting"""
        return await self.query(
            start_time=start_time,
            end_time=end_time,
            tenant_id=tenant_id,
            limit=100000  # Large limit for exports
        )


class AuditLogger:
    """High-level audit logger with convenience methods"""
    
    def __init__(self, store: Optional[AuditLogStore] = None):
        self.store = store or AuditLogStore()
        self._default_tenant: Optional[str] = os.getenv("TENANT_ID")
    
    async def log(
        self,
        event_type: AuditEventType,
        actor_id: str,
        actor_type: str,
        action: str,
        description: str = "",
        resource_type: str = "",
        resource_id: str = "",
        details: Optional[Dict[str, Any]] = None,
        severity: AuditSeverity = AuditSeverity.INFO,
        actor_ip: Optional[str] = None,
        actor_device: Optional[str] = None,
        tenant_id: Optional[str] = None,
        session_id: Optional[str] = None,
        request_id: Optional[str] = None,
        correlation_id: Optional[str] = None
    ) -> str:
        """Log an audit event"""
        event = AuditEvent(
            event_id=str(uuid4()),
            event_type=event_type,
            timestamp=datetime.now(timezone.utc).isoformat(),
            severity=severity,
            actor_id=actor_id,
            actor_type=actor_type,
            actor_ip=actor_ip,
            actor_device=actor_device,
            resource_type=resource_type,
            resource_id=resource_id,
            action=action,
            description=description,
            details=details or {},
            tenant_id=tenant_id or self._default_tenant,
            session_id=session_id,
            request_id=request_id,
            correlation_id=correlation_id
        )
        
        return await self.store.append(event)
    
    # Convenience methods for common events
    async def log_transaction(
        self,
        transaction_id: str,
        actor_id: str,
        action: str,
        amount: float,
        currency: str,
        status: str,
        details: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> str:
        """Log a transaction event"""
        event_type = {
            "initiated": AuditEventType.TRANSACTION_INITIATED,
            "completed": AuditEventType.TRANSACTION_COMPLETED,
            "failed": AuditEventType.TRANSACTION_FAILED,
            "reversed": AuditEventType.TRANSACTION_REVERSED
        }.get(status, AuditEventType.TRANSACTION_INITIATED)
        
        return await self.log(
            event_type=event_type,
            actor_id=actor_id,
            actor_type="agent",
            action=action,
            resource_type="transaction",
            resource_id=transaction_id,
            details={
                "amount": amount,
                "currency": currency,
                "status": status,
                **(details or {})
            },
            severity=AuditSeverity.CRITICAL if status == "failed" else AuditSeverity.INFO,
            **kwargs
        )
    
    async def log_kyc_event(
        self,
        customer_id: str,
        actor_id: str,
        action: str,
        status: str,
        details: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> str:
        """Log a KYC event"""
        event_type = {
            "initiated": AuditEventType.KYC_INITIATED,
            "document_uploaded": AuditEventType.KYC_DOCUMENT_UPLOADED,
            "verification_started": AuditEventType.KYC_VERIFICATION_STARTED,
            "verification_completed": AuditEventType.KYC_VERIFICATION_COMPLETED,
            "approved": AuditEventType.KYC_APPROVED,
            "rejected": AuditEventType.KYC_REJECTED,
            "override": AuditEventType.KYC_OVERRIDE
        }.get(status, AuditEventType.KYC_INITIATED)
        
        severity = AuditSeverity.WARNING if status in ("rejected", "override") else AuditSeverity.INFO
        
        return await self.log(
            event_type=event_type,
            actor_id=actor_id,
            actor_type="system" if status in ("verification_started", "verification_completed") else "user",
            action=action,
            resource_type="customer",
            resource_id=customer_id,
            details={"status": status, **(details or {})},
            severity=severity,
            **kwargs
        )
    
    async def log_admin_action(
        self,
        admin_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: Optional[Dict[str, Any]] = None,
        is_override: bool = False,
        **kwargs
    ) -> str:
        """Log an admin action"""
        return await self.log(
            event_type=AuditEventType.ADMIN_OVERRIDE if is_override else AuditEventType.ADMIN_ACTION,
            actor_id=admin_id,
            actor_type="admin",
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            severity=AuditSeverity.WARNING if is_override else AuditSeverity.INFO,
            **kwargs
        )
    
    async def log_auth_event(
        self,
        user_id: str,
        action: str,
        success: bool,
        details: Optional[Dict[str, Any]] = None,
        **kwargs
    ) -> str:
        """Log an authentication event"""
        event_type = {
            "login": AuditEventType.AUTH_LOGIN if success else AuditEventType.AUTH_FAILED,
            "logout": AuditEventType.AUTH_LOGOUT,
            "mfa_enabled": AuditEventType.AUTH_MFA_ENABLED,
            "password_changed": AuditEventType.AUTH_PASSWORD_CHANGED
        }.get(action, AuditEventType.AUTH_LOGIN)
        
        return await self.log(
            event_type=event_type,
            actor_id=user_id,
            actor_type="user",
            action=action,
            resource_type="auth",
            resource_id=user_id,
            details={"success": success, **(details or {})},
            severity=AuditSeverity.WARNING if not success else AuditSeverity.INFO,
            **kwargs
        )


# Global instance
_audit_logger: Optional[AuditLogger] = None


def get_audit_logger() -> AuditLogger:
    """Get the global audit logger instance"""
    global _audit_logger
    if _audit_logger is None:
        _audit_logger = AuditLogger()
    return _audit_logger


# Example usage
if __name__ == "__main__":
    async def main():
        logger = AuditLogger()
        
        # Log a transaction
        await logger.log_transaction(
            transaction_id="TXN-12345",
            actor_id="AGT-001",
            action="cash_in",
            amount=1000.00,
            currency="KES",
            status="completed",
            details={"customer_phone": "+254700000000"}
        )
        
        # Log a KYC event
        await logger.log_kyc_event(
            customer_id="CUST-001",
            actor_id="AGT-001",
            action="document_verification",
            status="approved",
            details={"document_type": "national_id"}
        )
        
        # Verify chain integrity
        result = await logger.store.verify_chain_integrity()
        print(f"Chain integrity: {result}")
    
    asyncio.run(main())
