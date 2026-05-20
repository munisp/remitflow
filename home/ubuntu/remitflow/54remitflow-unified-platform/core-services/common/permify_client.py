"""
Permify Authorization Service Client

Production-grade integration with Permify for fine-grained authorization.
Replaces the local PBAC engine with a distributed authorization service.

Features:
- Schema-based authorization model
- Relationship-based access control (ReBAC)
- Attribute-based access control (ABAC)
- Real-time permission checks
- Audit logging

Reference: https://docs.permify.co/
"""

import os
import logging
import asyncio
import httpx
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)

# Configuration
PERMIFY_HOST = os.getenv("PERMIFY_HOST", "http://localhost:3476")
PERMIFY_TENANT_ID = os.getenv("PERMIFY_TENANT_ID", "remittance-platform")
PERMIFY_API_KEY = os.getenv("PERMIFY_API_KEY", "")
PERMIFY_ENABLED = os.getenv("PERMIFY_ENABLED", "true").lower() == "true"
PERMIFY_TIMEOUT = int(os.getenv("PERMIFY_TIMEOUT", "5"))


class PermissionResult(str, Enum):
    """Permission check results"""
    ALLOWED = "ALLOWED"
    DENIED = "DENIED"
    ERROR = "ERROR"


@dataclass
class Subject:
    """Subject (user/service) requesting access"""
    type: str  # e.g., "user", "service", "admin"
    id: str
    relation: str = ""  # Optional relation for nested checks


@dataclass
class Resource:
    """Resource being accessed"""
    type: str  # e.g., "transaction", "wallet", "account"
    id: str


@dataclass
class PermissionCheck:
    """Permission check request"""
    subject: Subject
    permission: str  # e.g., "view", "edit", "delete", "approve"
    resource: Resource
    context: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PermissionResponse:
    """Permission check response"""
    allowed: bool
    result: PermissionResult
    reason: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    latency_ms: float = 0


# ==================== Permify Schema ====================

PERMIFY_SCHEMA = """
// Remittance Platform Authorization Schema

entity user {
    // User attributes
    attribute kyc_tier integer
    attribute risk_score float
    attribute region string
    attribute is_active boolean
    
    // User can view their own profile
    permission view_profile = self
    
    // User can edit their own profile
    permission edit_profile = self
}

entity wallet {
    // Wallet relationships
    relation owner @user
    relation viewer @user
    relation admin @user
    
    // Wallet attributes
    attribute currency string
    attribute balance float
    attribute is_frozen boolean
    
    // Permissions
    permission view = owner or viewer or admin
    permission transfer = owner and not is_frozen
    permission freeze = admin
    permission unfreeze = admin
}

entity transaction {
    // Transaction relationships
    relation initiator @user
    relation approver @user
    relation source_wallet @wallet
    relation destination_wallet @wallet
    
    // Transaction attributes
    attribute amount float
    attribute currency string
    attribute status string
    attribute requires_approval boolean
    attribute corridor string
    
    // Permissions
    permission view = initiator or approver or source_wallet.owner or destination_wallet.owner
    permission approve = approver and requires_approval
    permission cancel = initiator and status == "pending"
    permission refund = approver
}

entity account {
    // TigerBeetle account relationships
    relation owner @user
    relation operator @user
    
    // Account attributes
    attribute ledger integer
    attribute currency string
    attribute is_active boolean
    
    // Permissions
    permission view = owner or operator
    permission debit = owner and is_active
    permission credit = owner or operator
    permission close = owner
}

entity corridor {
    // Payment corridor relationships
    relation operator @user
    relation compliance_officer @user
    
    // Corridor attributes
    attribute source_country string
    attribute destination_country string
    attribute is_active boolean
    attribute daily_limit float
    
    // Permissions
    permission use = is_active
    permission configure = operator
    permission suspend = compliance_officer
}

entity settlement {
    // Settlement relationships
    relation initiator @user
    relation approver @user
    
    // Settlement attributes
    attribute amount float
    attribute status string
    
    // Permissions
    permission view = initiator or approver
    permission approve = approver and status == "pending"
    permission execute = approver and status == "approved"
}

entity kyc_document {
    // KYC document relationships
    relation owner @user
    relation reviewer @user
    
    // Document attributes
    attribute document_type string
    attribute status string
    attribute is_verified boolean
    
    // Permissions
    permission view = owner or reviewer
    permission upload = owner
    permission verify = reviewer
    permission reject = reviewer
}

entity organization {
    // Organization relationships
    relation member @user
    relation admin @user
    relation owner @user
    
    // Organization permissions
    permission view = member or admin or owner
    permission manage_members = admin or owner
    permission delete = owner
}

entity role {
    // Role relationships
    relation assignee @user
    
    // Role types
    attribute role_type string  // admin, compliance, support, user
    
    // Role-based permissions
    permission admin_access = role_type == "admin"
    permission compliance_access = role_type == "compliance" or role_type == "admin"
    permission support_access = role_type == "support" or role_type == "admin"
}
"""


class PermifyClient:
    """
    Permify authorization client
    
    Provides fine-grained authorization checks using Permify's
    relationship-based access control (ReBAC) model.
    """
    
    def __init__(self):
        self.host = PERMIFY_HOST
        self.tenant_id = PERMIFY_TENANT_ID
        self.api_key = PERMIFY_API_KEY
        self.enabled = PERMIFY_ENABLED
        self.timeout = PERMIFY_TIMEOUT
        self._client: Optional[httpx.AsyncClient] = None
        self._schema_version: Optional[str] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client"""
        if self._client is None:
            headers = {"Content-Type": "application/json"}
            if self.api_key:
                headers["Authorization"] = f"Bearer {self.api_key}"
            
            self._client = httpx.AsyncClient(
                base_url=self.host,
                headers=headers,
                timeout=self.timeout
            )
        return self._client
    
    async def close(self):
        """Close the HTTP client"""
        if self._client:
            await self._client.aclose()
            self._client = None
    
    async def initialize_schema(self) -> Dict[str, Any]:
        """
        Initialize the Permify schema
        
        This should be called once during application startup
        to ensure the schema is up to date.
        """
        if not self.enabled:
            logger.info("Permify disabled, using local authorization")
            return {"success": True, "mode": "local"}
        
        try:
            client = await self._get_client()
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/schemas/write",
                json={"schema": PERMIFY_SCHEMA}
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                self._schema_version = result.get("schema_version")
                logger.info(f"Permify schema initialized, version: {self._schema_version}")
                return {"success": True, "schema_version": self._schema_version}
            else:
                logger.error(f"Failed to initialize Permify schema: {response.text}")
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error initializing Permify schema: {e}")
            return {"success": False, "error": str(e)}
    
    async def check_permission(
        self,
        check: PermissionCheck
    ) -> PermissionResponse:
        """
        Check if a subject has permission to perform an action on a resource
        
        Args:
            check: Permission check request
            
        Returns:
            PermissionResponse with allowed/denied result
        """
        start_time = datetime.now(timezone.utc)
        
        if not self.enabled:
            # Fall back to local authorization
            return await self._local_check(check)
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "metadata": {
                    "schema_version": self._schema_version or "",
                    "snap_token": "",
                    "depth": 20
                },
                "entity": {
                    "type": check.resource.type,
                    "id": check.resource.id
                },
                "permission": check.permission,
                "subject": {
                    "type": check.subject.type,
                    "id": check.subject.id,
                    "relation": check.subject.relation
                },
                "context": {
                    "tuples": [],
                    "attributes": [
                        {"entity": {"type": k.split(".")[0], "id": k.split(".")[1] if "." in k else ""}, 
                         "attribute": k.split(".")[-1], 
                         "value": v}
                        for k, v in check.context.items()
                    ] if check.context else []
                }
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/permissions/check",
                json=request_body
            )
            
            latency = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            
            if response.status_code == 200:
                result = response.json()
                allowed = result.get("can") == "CHECK_RESULT_ALLOWED"
                
                return PermissionResponse(
                    allowed=allowed,
                    result=PermissionResult.ALLOWED if allowed else PermissionResult.DENIED,
                    reason=result.get("metadata", {}).get("reason"),
                    metadata=result.get("metadata", {}),
                    latency_ms=latency
                )
            else:
                logger.error(f"Permify check failed: {response.text}")
                return PermissionResponse(
                    allowed=False,
                    result=PermissionResult.ERROR,
                    reason=f"Permify error: {response.status_code}",
                    latency_ms=latency
                )
                
        except Exception as e:
            latency = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            logger.error(f"Error checking permission: {e}")
            
            # Fall back to local check on error
            return await self._local_check(check)
    
    async def _local_check(self, check: PermissionCheck) -> PermissionResponse:
        """
        Local permission check fallback
        
        Used when Permify is disabled or unavailable.
        """
        # Import local policy engine
        from .policy_engine import get_policy_engine, Subject as PBACSubject, Resource as PBACResource
        
        engine = get_policy_engine()
        
        subject = PBACSubject(
            user_id=check.subject.id,
            roles=[check.subject.type],
            attributes=check.context
        )
        
        resource = PBACResource(
            type=check.resource.type,
            id=check.resource.id,
            attributes=check.context
        )
        
        decision = engine.authorize(subject, check.permission, resource)
        
        return PermissionResponse(
            allowed=decision.allowed,
            result=PermissionResult.ALLOWED if decision.allowed else PermissionResult.DENIED,
            reason=decision.reason,
            metadata={"policy_id": decision.policy_id, "mode": "local"}
        )
    
    async def write_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str,
        subject_relation: str = ""
    ) -> Dict[str, Any]:
        """
        Write a relationship tuple to Permify
        
        Example: User "user123" is the "owner" of wallet "wallet456"
        """
        if not self.enabled:
            logger.debug("Permify disabled, skipping relationship write")
            return {"success": True, "mode": "local"}
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "metadata": {
                    "schema_version": self._schema_version or ""
                },
                "tuples": [{
                    "entity": {
                        "type": entity_type,
                        "id": entity_id
                    },
                    "relation": relation,
                    "subject": {
                        "type": subject_type,
                        "id": subject_id,
                        "relation": subject_relation
                    }
                }]
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/data/write",
                json=request_body
            )
            
            if response.status_code in [200, 201]:
                result = response.json()
                logger.info(f"Relationship written: {entity_type}:{entity_id}#{relation}@{subject_type}:{subject_id}")
                return {"success": True, "snap_token": result.get("snap_token")}
            else:
                logger.error(f"Failed to write relationship: {response.text}")
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error writing relationship: {e}")
            return {"success": False, "error": str(e)}
    
    async def delete_relationship(
        self,
        entity_type: str,
        entity_id: str,
        relation: str,
        subject_type: str,
        subject_id: str
    ) -> Dict[str, Any]:
        """Delete a relationship tuple from Permify"""
        if not self.enabled:
            return {"success": True, "mode": "local"}
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "tuple_filter": {
                    "entity": {
                        "type": entity_type,
                        "ids": [entity_id]
                    },
                    "relation": relation,
                    "subject": {
                        "type": subject_type,
                        "ids": [subject_id]
                    }
                }
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/data/delete",
                json=request_body
            )
            
            if response.status_code in [200, 201]:
                return {"success": True}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error deleting relationship: {e}")
            return {"success": False, "error": str(e)}
    
    async def write_attribute(
        self,
        entity_type: str,
        entity_id: str,
        attribute: str,
        value: Any
    ) -> Dict[str, Any]:
        """
        Write an attribute to an entity in Permify
        
        Example: Set user "user123" kyc_tier to 2
        """
        if not self.enabled:
            return {"success": True, "mode": "local"}
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "metadata": {
                    "schema_version": self._schema_version or ""
                },
                "attributes": [{
                    "entity": {
                        "type": entity_type,
                        "id": entity_id
                    },
                    "attribute": attribute,
                    "value": value
                }]
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/data/write",
                json=request_body
            )
            
            if response.status_code in [200, 201]:
                logger.info(f"Attribute written: {entity_type}:{entity_id}.{attribute} = {value}")
                return {"success": True}
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error writing attribute: {e}")
            return {"success": False, "error": str(e)}
    
    async def lookup_subjects(
        self,
        entity_type: str,
        entity_id: str,
        permission: str,
        subject_type: str
    ) -> Dict[str, Any]:
        """
        Find all subjects that have a permission on an entity
        
        Example: Find all users who can view wallet "wallet456"
        """
        if not self.enabled:
            return {"success": True, "subjects": [], "mode": "local"}
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "metadata": {
                    "schema_version": self._schema_version or "",
                    "depth": 20
                },
                "entity": {
                    "type": entity_type,
                    "id": entity_id
                },
                "permission": permission,
                "subject_reference": {
                    "type": subject_type
                }
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/permissions/lookup-subject",
                json=request_body
            )
            
            if response.status_code == 200:
                result = response.json()
                return {
                    "success": True,
                    "subjects": result.get("subject_ids", [])
                }
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error looking up subjects: {e}")
            return {"success": False, "error": str(e)}
    
    async def lookup_entities(
        self,
        subject_type: str,
        subject_id: str,
        permission: str,
        entity_type: str
    ) -> Dict[str, Any]:
        """
        Find all entities that a subject has permission on
        
        Example: Find all wallets that user "user123" can view
        """
        if not self.enabled:
            return {"success": True, "entities": [], "mode": "local"}
        
        try:
            client = await self._get_client()
            
            request_body = {
                "tenant_id": self.tenant_id,
                "metadata": {
                    "schema_version": self._schema_version or "",
                    "depth": 20
                },
                "entity_type": entity_type,
                "permission": permission,
                "subject": {
                    "type": subject_type,
                    "id": subject_id
                }
            }
            
            response = await client.post(
                f"/v1/tenants/{self.tenant_id}/permissions/lookup-entity",
                json=request_body
            )
            
            if response.status_code == 200:
                result = response.json()
                return {
                    "success": True,
                    "entities": result.get("entity_ids", [])
                }
            else:
                return {"success": False, "error": response.text}
                
        except Exception as e:
            logger.error(f"Error looking up entities: {e}")
            return {"success": False, "error": str(e)}


# ==================== Singleton Instance ====================

_permify_client: Optional[PermifyClient] = None


def get_permify_client() -> PermifyClient:
    """Get the global Permify client instance"""
    global _permify_client
    if _permify_client is None:
        _permify_client = PermifyClient()
    return _permify_client


# ==================== Convenience Functions ====================

async def can_view_wallet(user_id: str, wallet_id: str) -> bool:
    """Check if user can view a wallet"""
    client = get_permify_client()
    result = await client.check_permission(PermissionCheck(
        subject=Subject(type="user", id=user_id),
        permission="view",
        resource=Resource(type="wallet", id=wallet_id)
    ))
    return result.allowed


async def can_transfer_from_wallet(user_id: str, wallet_id: str) -> bool:
    """Check if user can transfer from a wallet"""
    client = get_permify_client()
    result = await client.check_permission(PermissionCheck(
        subject=Subject(type="user", id=user_id),
        permission="transfer",
        resource=Resource(type="wallet", id=wallet_id)
    ))
    return result.allowed


async def can_approve_transaction(user_id: str, transaction_id: str) -> bool:
    """Check if user can approve a transaction"""
    client = get_permify_client()
    result = await client.check_permission(PermissionCheck(
        subject=Subject(type="user", id=user_id),
        permission="approve",
        resource=Resource(type="transaction", id=transaction_id)
    ))
    return result.allowed


async def can_use_corridor(user_id: str, corridor_id: str) -> bool:
    """Check if user can use a payment corridor"""
    client = get_permify_client()
    result = await client.check_permission(PermissionCheck(
        subject=Subject(type="user", id=user_id),
        permission="use",
        resource=Resource(type="corridor", id=corridor_id)
    ))
    return result.allowed


async def set_wallet_owner(wallet_id: str, user_id: str) -> Dict[str, Any]:
    """Set the owner of a wallet"""
    client = get_permify_client()
    return await client.write_relationship(
        entity_type="wallet",
        entity_id=wallet_id,
        relation="owner",
        subject_type="user",
        subject_id=user_id
    )


async def set_user_kyc_tier(user_id: str, tier: int) -> Dict[str, Any]:
    """Set user's KYC tier"""
    client = get_permify_client()
    return await client.write_attribute(
        entity_type="user",
        entity_id=user_id,
        attribute="kyc_tier",
        value=tier
    )


async def set_transaction_approver(transaction_id: str, user_id: str) -> Dict[str, Any]:
    """Set the approver for a transaction"""
    client = get_permify_client()
    return await client.write_relationship(
        entity_type="transaction",
        entity_id=transaction_id,
        relation="approver",
        subject_type="user",
        subject_id=user_id
    )
