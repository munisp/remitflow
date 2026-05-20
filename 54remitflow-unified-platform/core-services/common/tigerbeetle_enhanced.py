"""
Enhanced TigerBeetle Client
Production-grade ledger client with ALL TigerBeetle features including:
- Pending / Two-Phase Transfers (reserve -> post/void)
- Linked / Batch Transfers (atomic multi-leg operations)
- Account Flags (debits_must_not_exceed_credits, etc.)
- Transfer Flags (pending, void_pending, post_pending)
- Transfer Lookup and Idempotency
- Rich Account History

Reference: https://docs.tigerbeetle.com/
"""

import logging
import uuid
import hashlib
import struct
from typing import Dict, Any, Optional, List, Tuple, Callable, Awaitable
from decimal import Decimal
from datetime import datetime, timezone
from enum import IntFlag, Enum
from dataclasses import dataclass, field
import asyncio
import aiohttp
import os

logger = logging.getLogger(__name__)


# ==================== Account Flags ====================

class AccountFlags(IntFlag):
    """
    TigerBeetle account flags
    
    These flags enforce ledger-level invariants that prevent certain classes
    of bugs and fraud at the ledger layer rather than in application code.
    """
    NONE = 0
    
    # Linked: Account is part of a linked chain (for atomic operations)
    LINKED = 1 << 0
    
    # Debits must not exceed credits: Prevents overdrafts
    # Account balance can never go negative
    DEBITS_MUST_NOT_EXCEED_CREDITS = 1 << 1
    
    # Credits must not exceed debits: For liability accounts
    # Ensures credits don't exceed what was debited
    CREDITS_MUST_NOT_EXCEED_DEBITS = 1 << 2
    
    # History: Maintain full history for this account
    HISTORY = 1 << 3
    
    # Imported: Account was imported from external system
    IMPORTED = 1 << 4
    
    # Closed: Account is closed and cannot accept new transfers
    CLOSED = 1 << 5


class TransferFlags(IntFlag):
    """
    TigerBeetle transfer flags
    
    These flags control transfer behavior, especially for two-phase commits.
    """
    NONE = 0
    
    # Linked: Transfer is part of a linked chain (atomic batch)
    LINKED = 1 << 0
    
    # Pending: Two-phase transfer - reserves funds but doesn't complete
    PENDING = 1 << 1
    
    # Post pending: Completes a pending transfer
    POST_PENDING_TRANSFER = 1 << 2
    
    # Void pending: Cancels a pending transfer
    VOID_PENDING_TRANSFER = 1 << 3
    
    # Balancing debit: For double-entry bookkeeping
    BALANCING_DEBIT = 1 << 4
    
    # Balancing credit: For double-entry bookkeeping
    BALANCING_CREDIT = 1 << 5
    
    # Imported: Transfer was imported from external system
    IMPORTED = 1 << 6


class TransferState(Enum):
    """Transfer states"""
    PENDING = "PENDING"
    POSTED = "POSTED"
    VOIDED = "VOIDED"
    FAILED = "FAILED"


class LedgerType(Enum):
    """Ledger types for different use cases"""
    ASSET = "ASSET"
    LIABILITY = "LIABILITY"
    EQUITY = "EQUITY"
    REVENUE = "REVENUE"
    EXPENSE = "EXPENSE"


# ==================== Data Classes ====================

@dataclass
class Account:
    """TigerBeetle account"""
    id: int
    ledger: int
    code: int
    user_data_128: int = 0
    user_data_64: int = 0
    user_data_32: int = 0
    flags: AccountFlags = AccountFlags.NONE
    debits_pending: int = 0
    debits_posted: int = 0
    credits_pending: int = 0
    credits_posted: int = 0
    timestamp: int = 0
    
    @property
    def balance(self) -> int:
        """Get current balance (credits - debits)"""
        return (self.credits_posted - self.debits_posted)
    
    @property
    def available_balance(self) -> int:
        """Get available balance (excluding pending)"""
        return (self.credits_posted - self.debits_posted - self.debits_pending)
    
    @property
    def pending_balance(self) -> int:
        """Get pending balance"""
        return self.credits_pending - self.debits_pending
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "ledger": self.ledger,
            "code": self.code,
            "user_data_128": str(self.user_data_128),
            "user_data_64": str(self.user_data_64),
            "user_data_32": self.user_data_32,
            "flags": self.flags.value,
            "debits_pending": self.debits_pending,
            "debits_posted": self.debits_posted,
            "credits_pending": self.credits_pending,
            "credits_posted": self.credits_posted,
            "balance": self.balance,
            "available_balance": self.available_balance,
            "timestamp": self.timestamp
        }


@dataclass
class Transfer:
    """TigerBeetle transfer"""
    id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    ledger: int
    code: int
    user_data_128: int = 0
    user_data_64: int = 0
    user_data_32: int = 0
    flags: TransferFlags = TransferFlags.NONE
    pending_id: int = 0  # For post/void pending transfers
    timeout: int = 0  # For pending transfers (in seconds)
    timestamp: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": str(self.id),
            "debit_account_id": str(self.debit_account_id),
            "credit_account_id": str(self.credit_account_id),
            "amount": self.amount,
            "ledger": self.ledger,
            "code": self.code,
            "user_data_128": str(self.user_data_128),
            "user_data_64": str(self.user_data_64),
            "user_data_32": self.user_data_32,
            "flags": self.flags.value,
            "pending_id": str(self.pending_id) if self.pending_id else None,
            "timeout": self.timeout,
            "timestamp": self.timestamp
        }


@dataclass
class PendingTransfer:
    """Pending transfer tracking"""
    transfer_id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    ledger: int
    code: int
    state: TransferState = TransferState.PENDING
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    timeout_at: Optional[str] = None
    posted_at: Optional[str] = None
    voided_at: Optional[str] = None
    external_reference: Optional[str] = None


@dataclass
class LinkedTransferBatch:
    """Batch of linked transfers for atomic operations"""
    batch_id: str
    transfers: List[Transfer]
    state: TransferState = TransferState.PENDING
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


# ==================== Currency Codes ====================

CURRENCY_CODES = {
    'NGN': 566,  # Nigerian Naira
    'KES': 404,  # Kenyan Shilling
    'GHS': 936,  # Ghanaian Cedi
    'ZAR': 710,  # South African Rand
    'EGP': 818,  # Egyptian Pound
    'TZS': 834,  # Tanzanian Shilling
    'UGX': 800,  # Ugandan Shilling
    'XOF': 952,  # West African CFA Franc
    'XAF': 950,  # Central African CFA Franc
    'USD': 840,  # US Dollar
    'EUR': 978,  # Euro
    'GBP': 826,  # British Pound
    'INR': 356,  # Indian Rupee
    'BRL': 986,  # Brazilian Real
    'RWF': 646,  # Rwandan Franc
    'MAD': 504,  # Moroccan Dirham
    'USDT': 9001,  # Tether (stablecoin)
    'USDC': 9002,  # USD Coin (stablecoin)
}


# ==================== Enhanced TigerBeetle Client ====================

class EnhancedTigerBeetleClient:
    """
    Production-grade TigerBeetle client with ALL features
    
    Features:
    - Account creation with flags (no-overdraft, history, etc.)
    - Standard transfers
    - Pending / Two-phase transfers (reserve -> post/void)
    - Linked / Batch transfers (atomic multi-leg operations)
    - Transfer lookup and idempotency
    - Account history queries
    - Balance queries with pending amounts
    - Multi-currency support
    """
    
    def __init__(
        self,
        tigerbeetle_address: str = None,
        cluster_id: int = 0
    ):
        self.tigerbeetle_address = tigerbeetle_address or os.getenv(
            'TIGERBEETLE_ADDRESS',
            'http://localhost:3000'
        )
        self.cluster_id = cluster_id
        
        # In-memory tracking for pending transfers
        self._pending_transfers: Dict[int, PendingTransfer] = {}
        self._transfer_index: Dict[str, int] = {}  # external_ref -> transfer_id
        self._accounts: Dict[int, Account] = {}
        
        logger.info(f"Initialized Enhanced TigerBeetle client at {self.tigerbeetle_address}")
    
    def _generate_id(self) -> int:
        """Generate a unique 128-bit ID as integer"""
        return int(uuid.uuid4().hex[:32], 16)
    
    def _generate_deterministic_id(self, key: str) -> int:
        """Generate deterministic ID from a key (for idempotency)"""
        return int(hashlib.sha256(key.encode()).hexdigest()[:32], 16)
    
    async def _request(
        self,
        method: str,
        endpoint: str,
        json_data: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """Make HTTP request to TigerBeetle"""
        url = f"{self.tigerbeetle_address}{endpoint}"
        
        async with aiohttp.ClientSession() as session:
            async with session.request(
                method,
                url,
                json=json_data,
                timeout=aiohttp.ClientTimeout(total=30)
            ) as response:
                if response.status in [200, 201]:
                    try:
                        return await response.json()
                    except Exception:
                        return {"status": "success", "http_status": response.status}
                else:
                    error = await response.text()
                    logger.error(f"TigerBeetle request failed: {error}")
                    return {"success": False, "error": error, "http_status": response.status}
    
    # ==================== Account Operations ====================
    
    async def create_account(
        self,
        account_id: Optional[int] = None,
        ledger: int = 1,
        code: int = 0,
        currency: str = "NGN",
        flags: AccountFlags = AccountFlags.NONE,
        user_data: Optional[str] = None,
        prevent_overdraft: bool = True,
        maintain_history: bool = True
    ) -> Dict[str, Any]:
        """
        Create a TigerBeetle account with flags
        
        Args:
            account_id: Optional account ID (auto-generated if not provided)
            ledger: Ledger ID
            code: Account code (currency code if not specified)
            currency: Currency code
            flags: Account flags
            user_data: Optional user data string
            prevent_overdraft: If True, sets DEBITS_MUST_NOT_EXCEED_CREDITS flag
            maintain_history: If True, sets HISTORY flag
            
        Returns:
            Account creation result
        """
        if account_id is None:
            account_id = self._generate_id()
        
        if code == 0:
            code = CURRENCY_CODES.get(currency, 566)
        
        # Build flags
        account_flags = flags
        if prevent_overdraft:
            account_flags |= AccountFlags.DEBITS_MUST_NOT_EXCEED_CREDITS
        if maintain_history:
            account_flags |= AccountFlags.HISTORY
        
        # Convert user_data to integer
        user_data_128 = 0
        if user_data:
            user_data_128 = int(hashlib.sha256(user_data.encode()).hexdigest()[:32], 16)
        
        try:
            result = await self._request(
                "POST",
                "/accounts",
                {
                    "id": str(account_id),
                    "ledger": ledger,
                    "code": code,
                    "user_data_128": str(user_data_128),
                    "flags": account_flags.value
                }
            )
            
            if result.get("success") is not False:
                # Store account locally
                account = Account(
                    id=account_id,
                    ledger=ledger,
                    code=code,
                    user_data_128=user_data_128,
                    flags=account_flags
                )
                self._accounts[account_id] = account
                
                logger.info(f"Created account: {account_id}, flags: {account_flags}")
                
                return {
                    "success": True,
                    "account_id": account_id,
                    "ledger": ledger,
                    "code": code,
                    "currency": currency,
                    "flags": account_flags.value,
                    "flags_description": str(account_flags),
                    "prevent_overdraft": bool(account_flags & AccountFlags.DEBITS_MUST_NOT_EXCEED_CREDITS),
                    "maintain_history": bool(account_flags & AccountFlags.HISTORY)
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error creating account: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_account(self, account_id: int) -> Dict[str, Any]:
        """Get account details including balance"""
        try:
            result = await self._request("GET", f"/accounts/{account_id}")
            
            if result.get("success") is not False and "id" in result:
                account = Account(
                    id=int(result.get("id", account_id)),
                    ledger=result.get("ledger", 0),
                    code=result.get("code", 0),
                    user_data_128=int(result.get("user_data_128", 0)),
                    flags=AccountFlags(result.get("flags", 0)),
                    debits_pending=result.get("debits_pending", 0),
                    debits_posted=result.get("debits_posted", 0),
                    credits_pending=result.get("credits_pending", 0),
                    credits_posted=result.get("credits_posted", 0),
                    timestamp=result.get("timestamp", 0)
                )
                self._accounts[account_id] = account
                
                return {
                    "success": True,
                    **account.to_dict()
                }
            
            # Return from local cache if available
            if account_id in self._accounts:
                return {"success": True, **self._accounts[account_id].to_dict()}
            
            return {"success": False, "error": "Account not found"}
            
        except Exception as e:
            logger.error(f"Error getting account: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_account_balance(
        self,
        account_id: int,
        include_pending: bool = True
    ) -> Dict[str, Any]:
        """
        Get account balance with optional pending amounts
        
        Args:
            account_id: Account to query
            include_pending: Whether to include pending amounts
            
        Returns:
            Balance information
        """
        account_result = await self.get_account(account_id)
        
        if not account_result.get("success"):
            return account_result
        
        balance = account_result.get("balance", 0)
        available = account_result.get("available_balance", balance)
        
        return {
            "success": True,
            "account_id": account_id,
            "balance": balance,
            "available_balance": available,
            "pending_debits": account_result.get("debits_pending", 0),
            "pending_credits": account_result.get("credits_pending", 0),
            "total_debits": account_result.get("debits_posted", 0),
            "total_credits": account_result.get("credits_posted", 0)
        }
    
    # ==================== Standard Transfers ====================
    
    async def create_transfer(
        self,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        ledger: int = 1,
        code: int = 0,
        currency: str = "NGN",
        transfer_id: Optional[int] = None,
        external_reference: Optional[str] = None,
        user_data: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a standard (immediate) transfer
        
        Args:
            debit_account_id: Account to debit
            credit_account_id: Account to credit
            amount: Amount in minor units (e.g., kobo for NGN)
            ledger: Ledger ID
            code: Transfer code
            currency: Currency code
            transfer_id: Optional transfer ID (auto-generated if not provided)
            external_reference: Optional external reference for idempotency
            user_data: Optional user data
            
        Returns:
            Transfer result
        """
        if transfer_id is None:
            if external_reference:
                transfer_id = self._generate_deterministic_id(external_reference)
            else:
                transfer_id = self._generate_id()
        
        if code == 0:
            code = CURRENCY_CODES.get(currency, 566)
        
        user_data_128 = 0
        if user_data:
            user_data_128 = int(hashlib.sha256(user_data.encode()).hexdigest()[:32], 16)
        
        try:
            result = await self._request(
                "POST",
                "/transfers",
                {
                    "id": str(transfer_id),
                    "debit_account_id": str(debit_account_id),
                    "credit_account_id": str(credit_account_id),
                    "amount": amount,
                    "ledger": ledger,
                    "code": code,
                    "user_data_128": str(user_data_128),
                    "flags": TransferFlags.NONE.value
                }
            )
            
            if result.get("success") is not False:
                if external_reference:
                    self._transfer_index[external_reference] = transfer_id
                
                logger.info(f"Transfer created: {transfer_id}, amount: {amount}")
                
                return {
                    "success": True,
                    "transfer_id": transfer_id,
                    "debit_account_id": debit_account_id,
                    "credit_account_id": credit_account_id,
                    "amount": amount,
                    "state": TransferState.POSTED.value,
                    "external_reference": external_reference
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error creating transfer: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Two-Phase Transfers ====================
    
    async def create_pending_transfer(
        self,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        ledger: int = 1,
        code: int = 0,
        currency: str = "NGN",
        timeout_seconds: int = 300,
        transfer_id: Optional[int] = None,
        external_reference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create a pending (two-phase) transfer
        
        This reserves funds on the debit account without completing the transfer.
        The transfer must be posted or voided within the timeout period.
        
        Use this for:
        - Cross-system atomicity (reserve funds, call external API, then post/void)
        - Pre-authorization holds
        - Escrow-like patterns
        
        Args:
            debit_account_id: Account to debit
            credit_account_id: Account to credit
            amount: Amount in minor units
            ledger: Ledger ID
            code: Transfer code
            currency: Currency code
            timeout_seconds: How long the pending transfer is valid
            transfer_id: Optional transfer ID
            external_reference: Optional external reference
            
        Returns:
            Pending transfer result
        """
        if transfer_id is None:
            if external_reference:
                transfer_id = self._generate_deterministic_id(external_reference)
            else:
                transfer_id = self._generate_id()
        
        if code == 0:
            code = CURRENCY_CODES.get(currency, 566)
        
        try:
            result = await self._request(
                "POST",
                "/transfers",
                {
                    "id": str(transfer_id),
                    "debit_account_id": str(debit_account_id),
                    "credit_account_id": str(credit_account_id),
                    "amount": amount,
                    "ledger": ledger,
                    "code": code,
                    "flags": TransferFlags.PENDING.value,
                    "timeout": timeout_seconds
                }
            )
            
            if result.get("success") is not False:
                # Track pending transfer
                timeout_at = (datetime.now(timezone.utc).timestamp() + timeout_seconds)
                pending = PendingTransfer(
                    transfer_id=transfer_id,
                    debit_account_id=debit_account_id,
                    credit_account_id=credit_account_id,
                    amount=amount,
                    ledger=ledger,
                    code=code,
                    timeout_at=datetime.fromtimestamp(timeout_at, timezone.utc).isoformat(),
                    external_reference=external_reference
                )
                self._pending_transfers[transfer_id] = pending
                
                if external_reference:
                    self._transfer_index[external_reference] = transfer_id
                
                logger.info(f"Pending transfer created: {transfer_id}, amount: {amount}, timeout: {timeout_seconds}s")
                
                return {
                    "success": True,
                    "transfer_id": transfer_id,
                    "debit_account_id": debit_account_id,
                    "credit_account_id": credit_account_id,
                    "amount": amount,
                    "state": TransferState.PENDING.value,
                    "timeout_seconds": timeout_seconds,
                    "timeout_at": pending.timeout_at,
                    "external_reference": external_reference
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error creating pending transfer: {e}")
            return {"success": False, "error": str(e)}
    
    async def post_pending_transfer(
        self,
        pending_transfer_id: int,
        amount: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Post (complete) a pending transfer
        
        Args:
            pending_transfer_id: ID of the pending transfer to post
            amount: Optional amount (can be less than original pending amount)
            
        Returns:
            Post result
        """
        pending = self._pending_transfers.get(pending_transfer_id)
        if not pending:
            return {"success": False, "error": f"Pending transfer not found: {pending_transfer_id}"}
        
        if pending.state != TransferState.PENDING:
            return {"success": False, "error": f"Transfer is not pending: {pending.state.value}"}
        
        post_amount = amount if amount is not None else pending.amount
        post_transfer_id = self._generate_id()
        
        try:
            result = await self._request(
                "POST",
                "/transfers",
                {
                    "id": str(post_transfer_id),
                    "debit_account_id": str(pending.debit_account_id),
                    "credit_account_id": str(pending.credit_account_id),
                    "amount": post_amount,
                    "ledger": pending.ledger,
                    "code": pending.code,
                    "flags": TransferFlags.POST_PENDING_TRANSFER.value,
                    "pending_id": str(pending_transfer_id)
                }
            )
            
            if result.get("success") is not False:
                pending.state = TransferState.POSTED
                pending.posted_at = datetime.now(timezone.utc).isoformat()
                
                logger.info(f"Pending transfer posted: {pending_transfer_id}, amount: {post_amount}")
                
                return {
                    "success": True,
                    "pending_transfer_id": pending_transfer_id,
                    "post_transfer_id": post_transfer_id,
                    "amount": post_amount,
                    "state": TransferState.POSTED.value,
                    "posted_at": pending.posted_at
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error posting pending transfer: {e}")
            return {"success": False, "error": str(e)}
    
    async def void_pending_transfer(
        self,
        pending_transfer_id: int,
        reason: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Void (cancel) a pending transfer
        
        This releases the reserved funds back to the debit account.
        
        Args:
            pending_transfer_id: ID of the pending transfer to void
            reason: Optional reason for voiding
            
        Returns:
            Void result
        """
        pending = self._pending_transfers.get(pending_transfer_id)
        if not pending:
            return {"success": False, "error": f"Pending transfer not found: {pending_transfer_id}"}
        
        if pending.state != TransferState.PENDING:
            return {"success": False, "error": f"Transfer is not pending: {pending.state.value}"}
        
        void_transfer_id = self._generate_id()
        
        try:
            result = await self._request(
                "POST",
                "/transfers",
                {
                    "id": str(void_transfer_id),
                    "debit_account_id": str(pending.debit_account_id),
                    "credit_account_id": str(pending.credit_account_id),
                    "amount": 0,  # Amount is 0 for void
                    "ledger": pending.ledger,
                    "code": pending.code,
                    "flags": TransferFlags.VOID_PENDING_TRANSFER.value,
                    "pending_id": str(pending_transfer_id)
                }
            )
            
            if result.get("success") is not False:
                pending.state = TransferState.VOIDED
                pending.voided_at = datetime.now(timezone.utc).isoformat()
                
                logger.info(f"Pending transfer voided: {pending_transfer_id}, reason: {reason}")
                
                return {
                    "success": True,
                    "pending_transfer_id": pending_transfer_id,
                    "void_transfer_id": void_transfer_id,
                    "state": TransferState.VOIDED.value,
                    "voided_at": pending.voided_at,
                    "reason": reason
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error voiding pending transfer: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== Linked / Batch Transfers ====================
    
    async def create_linked_transfers(
        self,
        transfers: List[Dict[str, Any]],
        batch_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Create linked (atomic) transfers
        
        All transfers in the batch either succeed or fail together.
        Use this for:
        - Multi-party fee splits (customer debit, fee credit, partner credit)
        - Double-entry bookkeeping
        - Complex settlement operations
        
        Args:
            transfers: List of transfer definitions, each with:
                - debit_account_id: Account to debit
                - credit_account_id: Account to credit
                - amount: Amount in minor units
                - ledger: Optional ledger ID
                - code: Optional transfer code
            batch_id: Optional batch identifier
            
        Returns:
            Batch result with all transfer IDs
        """
        if not transfers:
            return {"success": False, "error": "No transfers provided"}
        
        if batch_id is None:
            batch_id = str(uuid.uuid4())
        
        # Build linked transfer batch
        transfer_requests = []
        transfer_ids = []
        
        for i, t in enumerate(transfers):
            transfer_id = self._generate_id()
            transfer_ids.append(transfer_id)
            
            # Set LINKED flag for all except the last transfer
            flags = TransferFlags.LINKED if i < len(transfers) - 1 else TransferFlags.NONE
            
            transfer_requests.append({
                "id": str(transfer_id),
                "debit_account_id": str(t["debit_account_id"]),
                "credit_account_id": str(t["credit_account_id"]),
                "amount": t["amount"],
                "ledger": t.get("ledger", 1),
                "code": t.get("code", 0),
                "flags": flags.value
            })
        
        try:
            # Send batch request
            result = await self._request(
                "POST",
                "/transfers/batch",
                {"transfers": transfer_requests}
            )
            
            if result.get("success") is not False:
                logger.info(f"Linked transfers created: batch={batch_id}, count={len(transfers)}")
                
                return {
                    "success": True,
                    "batch_id": batch_id,
                    "transfer_ids": transfer_ids,
                    "transfer_count": len(transfers),
                    "total_amount": sum(t["amount"] for t in transfers),
                    "state": TransferState.POSTED.value
                }
            else:
                return result
                
        except Exception as e:
            logger.error(f"Error creating linked transfers: {e}")
            return {"success": False, "error": str(e)}
    
    async def create_fee_split_transfer(
        self,
        customer_account_id: int,
        merchant_account_id: int,
        fee_account_id: int,
        partner_account_id: Optional[int],
        total_amount: int,
        fee_amount: int,
        partner_amount: int = 0,
        ledger: int = 1,
        code: int = 0
    ) -> Dict[str, Any]:
        """
        Create a fee split transfer (atomic multi-party operation)
        
        This is a convenience method for the common pattern of:
        - Debiting customer
        - Crediting merchant (minus fees)
        - Crediting fee account
        - Optionally crediting partner account
        
        Args:
            customer_account_id: Customer account to debit
            merchant_account_id: Merchant account to credit
            fee_account_id: Fee account to credit
            partner_account_id: Optional partner account to credit
            total_amount: Total amount to debit from customer
            fee_amount: Amount to credit to fee account
            partner_amount: Amount to credit to partner account
            ledger: Ledger ID
            code: Transfer code
            
        Returns:
            Fee split result
        """
        merchant_amount = total_amount - fee_amount - partner_amount
        
        if merchant_amount < 0:
            return {"success": False, "error": "Fee + partner amount exceeds total amount"}
        
        transfers = [
            {
                "debit_account_id": customer_account_id,
                "credit_account_id": merchant_account_id,
                "amount": merchant_amount,
                "ledger": ledger,
                "code": code
            },
            {
                "debit_account_id": customer_account_id,
                "credit_account_id": fee_account_id,
                "amount": fee_amount,
                "ledger": ledger,
                "code": code
            }
        ]
        
        if partner_account_id and partner_amount > 0:
            transfers.append({
                "debit_account_id": customer_account_id,
                "credit_account_id": partner_account_id,
                "amount": partner_amount,
                "ledger": ledger,
                "code": code
            })
        
        result = await self.create_linked_transfers(transfers)
        
        if result.get("success"):
            result["fee_split"] = {
                "total_amount": total_amount,
                "merchant_amount": merchant_amount,
                "fee_amount": fee_amount,
                "partner_amount": partner_amount
            }
        
        return result
    
    # ==================== Transfer Lookup ====================
    
    async def get_transfer(self, transfer_id: int) -> Dict[str, Any]:
        """Get transfer by ID"""
        try:
            result = await self._request("GET", f"/transfers/{transfer_id}")
            
            if result.get("success") is not False and "id" in result:
                return {
                    "success": True,
                    "transfer_id": transfer_id,
                    "debit_account_id": int(result.get("debit_account_id", 0)),
                    "credit_account_id": int(result.get("credit_account_id", 0)),
                    "amount": result.get("amount", 0),
                    "ledger": result.get("ledger", 0),
                    "code": result.get("code", 0),
                    "flags": result.get("flags", 0),
                    "timestamp": result.get("timestamp", 0)
                }
            
            # Check pending transfers
            if transfer_id in self._pending_transfers:
                pending = self._pending_transfers[transfer_id]
                return {
                    "success": True,
                    "transfer_id": transfer_id,
                    "debit_account_id": pending.debit_account_id,
                    "credit_account_id": pending.credit_account_id,
                    "amount": pending.amount,
                    "ledger": pending.ledger,
                    "code": pending.code,
                    "state": pending.state.value,
                    "is_pending": pending.state == TransferState.PENDING
                }
            
            return {"success": False, "error": "Transfer not found"}
            
        except Exception as e:
            logger.error(f"Error getting transfer: {e}")
            return {"success": False, "error": str(e)}
    
    async def lookup_transfer_by_reference(self, external_reference: str) -> Dict[str, Any]:
        """
        Look up transfer by external reference (idempotency check)
        
        Args:
            external_reference: External reference string
            
        Returns:
            Transfer if found, or not found error
        """
        transfer_id = self._transfer_index.get(external_reference)
        
        if transfer_id:
            return await self.get_transfer(transfer_id)
        
        return {"success": False, "error": "Transfer not found for reference", "reference": external_reference}
    
    # ==================== Account History ====================
    
    async def get_account_transfers(
        self,
        account_id: int,
        limit: int = 100,
        direction: str = "both"
    ) -> Dict[str, Any]:
        """
        Get transfer history for an account
        
        Args:
            account_id: Account to query
            limit: Maximum transfers to return
            direction: "debit", "credit", or "both"
            
        Returns:
            List of transfers
        """
        try:
            result = await self._request(
                "GET",
                f"/accounts/{account_id}/transfers",
                {"limit": limit}
            )
            
            if result.get("success") is not False:
                transfers = result.get("transfers", [])
                
                # Filter by direction if specified
                if direction == "debit":
                    transfers = [t for t in transfers if int(t.get("debit_account_id", 0)) == account_id]
                elif direction == "credit":
                    transfers = [t for t in transfers if int(t.get("credit_account_id", 0)) == account_id]
                
                return {
                    "success": True,
                    "account_id": account_id,
                    "transfers": transfers[:limit],
                    "count": len(transfers)
                }
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting account transfers: {e}")
            return {"success": False, "error": str(e)}
    
    # ==================== High-Level Operations ====================
    
    async def transfer_with_two_phase(
        self,
        debit_account_id: int,
        credit_account_id: int,
        amount: int,
        external_operation: Callable[[], Awaitable[bool]],
        timeout_seconds: int = 300,
        external_reference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Execute a transfer with two-phase commit pattern
        
        This is the recommended pattern for cross-system atomicity:
        1. Create pending transfer (reserve funds)
        2. Execute external operation
        3. If external succeeds: post pending transfer
        4. If external fails: void pending transfer
        
        Args:
            debit_account_id: Account to debit
            credit_account_id: Account to credit
            amount: Amount in minor units
            external_operation: Async function that returns True on success
            timeout_seconds: Timeout for pending transfer
            external_reference: Optional external reference
            
        Returns:
            Transfer result
        """
        # Step 1: Create pending transfer
        pending_result = await self.create_pending_transfer(
            debit_account_id=debit_account_id,
            credit_account_id=credit_account_id,
            amount=amount,
            timeout_seconds=timeout_seconds,
            external_reference=external_reference
        )
        
        if not pending_result.get("success"):
            return pending_result
        
        pending_transfer_id = pending_result["transfer_id"]
        
        try:
            # Step 2: Execute external operation
            external_success = await external_operation()
            
            if external_success:
                # Step 3a: Post pending transfer
                post_result = await self.post_pending_transfer(pending_transfer_id)
                
                if post_result.get("success"):
                    return {
                        "success": True,
                        "transfer_id": pending_transfer_id,
                        "state": TransferState.POSTED.value,
                        "amount": amount,
                        "external_reference": external_reference
                    }
                else:
                    # Post failed, try to void
                    await self.void_pending_transfer(pending_transfer_id, "Post failed")
                    return post_result
            else:
                # Step 3b: Void pending transfer
                void_result = await self.void_pending_transfer(
                    pending_transfer_id,
                    "External operation failed"
                )
                
                return {
                    "success": False,
                    "transfer_id": pending_transfer_id,
                    "state": TransferState.VOIDED.value,
                    "reason": "External operation failed",
                    "void_result": void_result
                }
                
        except Exception as e:
            # On any error, void the pending transfer
            logger.error(f"Error in two-phase transfer: {e}")
            await self.void_pending_transfer(pending_transfer_id, f"Error: {str(e)}")
            return {"success": False, "error": str(e), "transfer_id": pending_transfer_id}
    
    async def process_payment_with_fees(
        self,
        customer_account_id: int,
        merchant_account_id: int,
        fee_account_id: int,
        amount: int,
        fee_percentage: Decimal = Decimal("0.015"),
        min_fee: int = 100,
        max_fee: int = 500000,
        external_reference: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process a payment with automatic fee calculation and atomic split
        
        Args:
            customer_account_id: Customer account to debit
            merchant_account_id: Merchant account to credit
            fee_account_id: Fee account to credit
            amount: Total amount to charge customer
            fee_percentage: Fee as decimal (0.015 = 1.5%)
            min_fee: Minimum fee in minor units
            max_fee: Maximum fee in minor units
            external_reference: Optional external reference
            
        Returns:
            Payment result with fee breakdown
        """
        # Calculate fee
        calculated_fee = int(Decimal(amount) * fee_percentage)
        fee = max(min_fee, min(calculated_fee, max_fee))
        merchant_amount = amount - fee
        
        # Create atomic fee split
        result = await self.create_fee_split_transfer(
            customer_account_id=customer_account_id,
            merchant_account_id=merchant_account_id,
            fee_account_id=fee_account_id,
            partner_account_id=None,
            total_amount=amount,
            fee_amount=fee,
            partner_amount=0
        )
        
        if result.get("success"):
            result["payment"] = {
                "total_charged": amount,
                "merchant_receives": merchant_amount,
                "fee_charged": fee,
                "fee_percentage": float(fee_percentage * 100),
                "external_reference": external_reference
            }
        
        return result


# ==================== Factory Function ====================

def get_enhanced_tigerbeetle_client(
    tigerbeetle_address: str = None
) -> EnhancedTigerBeetleClient:
    """Get enhanced TigerBeetle client instance"""
    return EnhancedTigerBeetleClient(
        tigerbeetle_address=tigerbeetle_address or os.getenv(
            'TIGERBEETLE_ADDRESS',
            'http://localhost:3000'
        )
    )
