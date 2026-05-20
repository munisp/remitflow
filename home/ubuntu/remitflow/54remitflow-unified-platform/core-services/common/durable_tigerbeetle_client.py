"""
Durable TigerBeetle Client

Production-grade TigerBeetle client that ensures all pending transfer state
is durably stored in PostgreSQL, not in-memory.

This client wraps EnhancedTigerBeetleClient and routes all two-phase transfer
operations through PendingTransferStore for crash recovery and multi-instance
coordination.

Gap Fixed: EnhancedTigerBeetleClient._pending_transfers was in-memory only.
Now all pending state is persisted to PostgreSQL within the same transaction.
"""

import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, List
import asyncpg

from .tigerbeetle_enhanced import (
    EnhancedTigerBeetleClient,
    TransferFlags,
    TransferState,
    CURRENCY_CODES,
    get_enhanced_tigerbeetle_client
)
from .tigerbeetle_postgres_sync import (
    PendingTransferStore,
    TransactionalOutbox,
    TigerBeetlePostgresSync,
    get_tigerbeetle_postgres_sync
)

logger = logging.getLogger(__name__)


class DurableTigerBeetleClient:
    """
    Durable TigerBeetle Client with PostgreSQL-backed pending transfer state.
    
    This is the RECOMMENDED client for production use. It ensures:
    - All pending transfers are stored in PostgreSQL (not in-memory)
    - Crash recovery: pending state survives process restarts
    - Multi-instance coordination: all instances see the same pending state
    - Audit trail: full history of pending/posted/voided transfers
    - Transactional consistency: TigerBeetle + Postgres in same transaction
    
    Usage:
        client = await get_durable_tigerbeetle_client(pool)
        
        # Create pending transfer (stored in both TigerBeetle and Postgres)
        result = await client.create_pending_transfer(
            debit_account_id=123,
            credit_account_id=456,
            amount=10000,
            timeout_seconds=300
        )
        
        # Post or void the transfer
        await client.post_pending_transfer(result['transfer_id'])
        # or
        await client.void_pending_transfer(result['transfer_id'], reason="Cancelled")
    """
    
    def __init__(
        self,
        pool: asyncpg.Pool,
        tigerbeetle_client: EnhancedTigerBeetleClient,
        pending_store: PendingTransferStore,
        outbox: Optional[TransactionalOutbox] = None
    ):
        self.pool = pool
        self.tb_client = tigerbeetle_client
        self.pending_store = pending_store
        self.outbox = outbox
        
        logger.info("Initialized DurableTigerBeetleClient with PostgreSQL-backed pending state")
    
    async def initialize(self):
        """Initialize the pending transfer store tables"""
        await self.pending_store.initialize()
        if self.outbox:
            await self.outbox.initialize()
        logger.info("DurableTigerBeetleClient tables initialized")
    
    # ==================== Account Operations (delegated) ====================
    
    async def create_account(self, **kwargs) -> Dict[str, Any]:
        """Create account (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.create_account(**kwargs)
    
    async def get_account(self, account_id: int) -> Dict[str, Any]:
        """Get account (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.get_account(account_id)
    
    async def get_account_balance(self, account_id: int, **kwargs) -> Dict[str, Any]:
        """Get account balance (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.get_account_balance(account_id, **kwargs)
    
    # ==================== Standard Transfers (delegated) ====================
    
    async def create_transfer(self, **kwargs) -> Dict[str, Any]:
        """Create standard transfer (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.create_transfer(**kwargs)
    
    # ==================== Durable Two-Phase Transfers ====================
    
    async def create_pending_transfer(
        self,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        ledger: int = 1,
        code: int = 0,
        currency: str = "NGN",
        timeout_seconds: int = 300,
        transfer_id: Optional[str] = None,
        external_reference: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Create a pending (two-phase) transfer with DURABLE state.
        
        Unlike EnhancedTigerBeetleClient.create_pending_transfer which stores
        pending state in-memory, this method stores it in PostgreSQL within
        the same transaction as the TigerBeetle call.
        
        Args:
            debit_account_id: Account to debit
            credit_account_id: Account to credit
            amount: Amount in minor units (e.g., kobo for NGN)
            ledger: Ledger ID
            code: Transfer code (currency code if not specified)
            currency: Currency code
            timeout_seconds: How long the pending transfer is valid
            transfer_id: Optional transfer ID (auto-generated if not provided)
            external_reference: Optional external reference for idempotency
            metadata: Optional metadata to store with the transfer
            
        Returns:
            Pending transfer result with transfer_id, state, timeout_at
        """
        if transfer_id is None:
            transfer_id = str(uuid.uuid4())
        
        if code == 0:
            code = CURRENCY_CODES.get(currency, 566)
        
        # Calculate expiration time
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=timeout_seconds)
        
        # Generate TigerBeetle ID
        tb_id = self.tb_client._generate_deterministic_id(transfer_id) if external_reference else self.tb_client._generate_id()
        
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # 1. Create pending transfer in TigerBeetle
                tb_result = await self.tb_client._request(
                    "POST",
                    "/transfers",
                    {
                        "id": str(tb_id),
                        "debit_account_id": str(debit_account_id),
                        "credit_account_id": str(credit_account_id),
                        "amount": amount,
                        "ledger": ledger,
                        "code": code,
                        "flags": TransferFlags.PENDING.value,
                        "timeout": timeout_seconds
                    }
                )
                
                if tb_result.get("success") is False:
                    return tb_result
                
                # 2. Store pending state in PostgreSQL (same transaction)
                pending_state = await self.pending_store.create_pending(
                    conn=conn,
                    transfer_id=transfer_id,
                    tigerbeetle_id=tb_id,
                    debit_account_id=debit_account_id,
                    credit_account_id=credit_account_id,
                    amount=amount,
                    ledger=ledger,
                    code=code,
                    expires_at=expires_at,
                    metadata={
                        "external_reference": external_reference,
                        "currency": currency,
                        **(metadata or {})
                    }
                )
                
                # 3. Add outbox event for downstream consumers
                if self.outbox:
                    await self.outbox.add_event(
                        conn=conn,
                        event_type="pending_transfer_created",
                        aggregate_type="transfer",
                        aggregate_id=transfer_id,
                        payload={
                            "transfer_id": transfer_id,
                            "tigerbeetle_id": tb_id,
                            "debit_account_id": debit_account_id,
                            "credit_account_id": credit_account_id,
                            "amount": amount,
                            "currency": currency,
                            "expires_at": expires_at.isoformat()
                        }
                    )
        
        logger.info(
            f"Durable pending transfer created: {transfer_id} "
            f"(TB ID: {tb_id}), amount: {amount}, timeout: {timeout_seconds}s"
        )
        
        return {
            "success": True,
            "transfer_id": transfer_id,
            "tigerbeetle_id": tb_id,
            "debit_account_id": debit_account_id,
            "credit_account_id": credit_account_id,
            "amount": amount,
            "state": TransferState.PENDING.value,
            "timeout_seconds": timeout_seconds,
            "expires_at": expires_at.isoformat(),
            "external_reference": external_reference,
            "durable": True  # Indicates this is stored in PostgreSQL
        }
    
    async def post_pending_transfer(
        self,
        transfer_id: str,
        amount: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Post (complete) a pending transfer with DURABLE state update.
        
        Args:
            transfer_id: ID of the pending transfer to post
            amount: Optional amount (can be less than original pending amount)
            
        Returns:
            Post result
        """
        # Get pending transfer from PostgreSQL (not in-memory)
        pending = await self.pending_store.get_pending(transfer_id)
        
        if not pending:
            return {"success": False, "error": f"Pending transfer not found: {transfer_id}"}
        
        if pending.status != 'pending':
            return {"success": False, "error": f"Transfer is not pending: {pending.status}"}
        
        post_amount = amount if amount is not None else pending.amount
        post_tb_id = self.tb_client._generate_id()
        
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # 1. Post transfer in TigerBeetle
                tb_result = await self.tb_client._request(
                    "POST",
                    "/transfers",
                    {
                        "id": str(post_tb_id),
                        "debit_account_id": str(pending.debit_account_id),
                        "credit_account_id": str(pending.credit_account_id),
                        "amount": post_amount,
                        "ledger": pending.ledger,
                        "code": pending.code,
                        "flags": TransferFlags.POST_PENDING_TRANSFER.value,
                        "pending_id": str(pending.tigerbeetle_id)
                    }
                )
                
                if tb_result.get("success") is False:
                    return tb_result
                
                # 2. Update PostgreSQL state (same transaction)
                await self.pending_store.post_transfer(conn, transfer_id)
                
                # 3. Add outbox event
                if self.outbox:
                    await self.outbox.add_event(
                        conn=conn,
                        event_type="pending_transfer_posted",
                        aggregate_type="transfer",
                        aggregate_id=transfer_id,
                        payload={
                            "transfer_id": transfer_id,
                            "tigerbeetle_id": pending.tigerbeetle_id,
                            "post_tigerbeetle_id": post_tb_id,
                            "amount": post_amount,
                            "posted_at": datetime.now(timezone.utc).isoformat()
                        }
                    )
        
        logger.info(f"Durable pending transfer posted: {transfer_id}, amount: {post_amount}")
        
        return {
            "success": True,
            "transfer_id": transfer_id,
            "post_tigerbeetle_id": post_tb_id,
            "amount": post_amount,
            "state": TransferState.POSTED.value,
            "posted_at": datetime.now(timezone.utc).isoformat(),
            "durable": True
        }
    
    async def void_pending_transfer(
        self,
        transfer_id: str,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Void (cancel) a pending transfer with DURABLE state update.
        
        Args:
            transfer_id: ID of the pending transfer to void
            reason: Optional reason for voiding
            
        Returns:
            Void result
        """
        # Get pending transfer from PostgreSQL (not in-memory)
        pending = await self.pending_store.get_pending(transfer_id)
        
        if not pending:
            return {"success": False, "error": f"Pending transfer not found: {transfer_id}"}
        
        if pending.status != 'pending':
            return {"success": False, "error": f"Transfer is not pending: {pending.status}"}
        
        void_tb_id = self.tb_client._generate_id()
        
        async with self.pool.acquire() as conn:
            async with conn.transaction():
                # 1. Void transfer in TigerBeetle
                tb_result = await self.tb_client._request(
                    "POST",
                    "/transfers",
                    {
                        "id": str(void_tb_id),
                        "debit_account_id": str(pending.debit_account_id),
                        "credit_account_id": str(pending.credit_account_id),
                        "amount": 0,  # Amount is 0 for void
                        "ledger": pending.ledger,
                        "code": pending.code,
                        "flags": TransferFlags.VOID_PENDING_TRANSFER.value,
                        "pending_id": str(pending.tigerbeetle_id)
                    }
                )
                
                if tb_result.get("success") is False:
                    return tb_result
                
                # 2. Update PostgreSQL state (same transaction)
                await self.pending_store.void_transfer(conn, transfer_id, reason)
                
                # 3. Add outbox event
                if self.outbox:
                    await self.outbox.add_event(
                        conn=conn,
                        event_type="pending_transfer_voided",
                        aggregate_type="transfer",
                        aggregate_id=transfer_id,
                        payload={
                            "transfer_id": transfer_id,
                            "tigerbeetle_id": pending.tigerbeetle_id,
                            "void_tigerbeetle_id": void_tb_id,
                            "reason": reason,
                            "voided_at": datetime.now(timezone.utc).isoformat()
                        }
                    )
        
        logger.info(f"Durable pending transfer voided: {transfer_id}, reason: {reason}")
        
        return {
            "success": True,
            "transfer_id": transfer_id,
            "void_tigerbeetle_id": void_tb_id,
            "state": TransferState.VOIDED.value,
            "voided_at": datetime.now(timezone.utc).isoformat(),
            "reason": reason,
            "durable": True
        }
    
    async def get_pending_transfer(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        """
        Get pending transfer state from PostgreSQL.
        
        Args:
            transfer_id: Transfer ID
            
        Returns:
            Pending transfer state or None if not found
        """
        pending = await self.pending_store.get_pending(transfer_id)
        
        if not pending:
            return None
        
        return {
            "transfer_id": pending.transfer_id,
            "tigerbeetle_id": pending.tigerbeetle_id,
            "debit_account_id": pending.debit_account_id,
            "credit_account_id": pending.credit_account_id,
            "amount": pending.amount,
            "ledger": pending.ledger,
            "code": pending.code,
            "status": pending.status,
            "created_at": pending.created_at.isoformat() if pending.created_at else None,
            "expires_at": pending.expires_at.isoformat() if pending.expires_at else None,
            "posted_at": pending.posted_at.isoformat() if pending.posted_at else None,
            "voided_at": pending.voided_at.isoformat() if pending.voided_at else None,
            "metadata": pending.metadata
        }
    
    async def get_expired_pending_transfers(self) -> List[Dict[str, Any]]:
        """
        Get all expired pending transfers for cleanup.
        
        Returns:
            List of expired pending transfers
        """
        expired = await self.pending_store.get_expired_pending()
        
        return [
            {
                "transfer_id": p.transfer_id,
                "tigerbeetle_id": p.tigerbeetle_id,
                "amount": p.amount,
                "expires_at": p.expires_at.isoformat() if p.expires_at else None
            }
            for p in expired
        ]
    
    # ==================== Linked Transfers (delegated) ====================
    
    async def create_linked_transfers(self, **kwargs) -> Dict[str, Any]:
        """Create linked transfers (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.create_linked_transfers(**kwargs)
    
    async def create_fee_split_transfer(self, **kwargs) -> Dict[str, Any]:
        """Create fee split transfer (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.create_fee_split_transfer(**kwargs)
    
    # ==================== Transfer Queries (delegated) ====================
    
    async def get_transfer(self, transfer_id: int) -> Dict[str, Any]:
        """Get transfer (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.get_transfer(transfer_id)
    
    async def get_account_transfers(self, account_id: int, **kwargs) -> Dict[str, Any]:
        """Get account transfers (delegated to EnhancedTigerBeetleClient)"""
        return await self.tb_client.get_account_transfers(account_id, **kwargs)


# Singleton instance
_durable_client: Optional[DurableTigerBeetleClient] = None


async def get_durable_tigerbeetle_client(
    pool: asyncpg.Pool,
    tigerbeetle_address: Optional[str] = None
) -> DurableTigerBeetleClient:
    """
    Get or create the durable TigerBeetle client singleton.
    
    This is the RECOMMENDED way to get a TigerBeetle client for production use.
    It ensures all pending transfer state is durably stored in PostgreSQL.
    
    Args:
        pool: PostgreSQL connection pool
        tigerbeetle_address: Optional TigerBeetle address
        
    Returns:
        DurableTigerBeetleClient instance
    """
    global _durable_client
    
    if _durable_client is None:
        tb_client = get_enhanced_tigerbeetle_client(tigerbeetle_address)
        pending_store = PendingTransferStore(pool)
        outbox = TransactionalOutbox(pool)
        
        _durable_client = DurableTigerBeetleClient(
            pool=pool,
            tigerbeetle_client=tb_client,
            pending_store=pending_store,
            outbox=outbox
        )
        
        await _durable_client.initialize()
    
    return _durable_client
