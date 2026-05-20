"""
TigerBeetle Integration for Multi-Bank Smart Routing
Internal ledger for tracking all bank account balances and transactions
"""

import asyncio
import hashlib
import json
import logging
import os
import struct
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from enum import IntEnum, Enum
from typing import Any, Dict, List, Optional, Tuple

import asyncpg
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


class AccountType(IntEnum):
    BANK_FLOAT = 1
    AGENT_WALLET = 2
    SETTLEMENT = 3
    FEE_COLLECTION = 4
    SUSPENSE = 5
    RECONCILIATION = 6


class TransferType(IntEnum):
    PAYOUT = 1
    COLLECTION = 2
    SWEEP = 3
    FEE = 4
    ADJUSTMENT = 5
    REVERSAL = 6


class TransferStatus(str, Enum):
    PENDING = "pending"
    RESERVED = "reserved"
    COMMITTED = "committed"
    ABORTED = "aborted"
    FAILED = "failed"


@dataclass
class TigerBeetleAccount:
    id: int
    ledger: int
    code: int
    flags: int = 0
    debits_pending: int = 0
    debits_posted: int = 0
    credits_pending: int = 0
    credits_posted: int = 0
    user_data_128: bytes = field(default_factory=lambda: b'\x00' * 16)
    user_data_64: int = 0
    user_data_32: int = 0
    timestamp: int = 0


@dataclass
class TigerBeetleTransfer:
    id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    pending_id: int = 0
    ledger: int = 1
    code: int = 1
    flags: int = 0
    user_data_128: bytes = field(default_factory=lambda: b'\x00' * 16)
    user_data_64: int = 0
    user_data_32: int = 0
    timeout: int = 0
    timestamp: int = 0


class TigerBeetleLedger:
    """TigerBeetle-based internal ledger for multi-bank routing"""
    
    def __init__(
        self,
        tigerbeetle_url: str = None,
        db_pool: asyncpg.Pool = None,
        cluster_id: int = 0
    ):
        self.tigerbeetle_url = tigerbeetle_url or os.getenv("TIGERBEETLE_URL", "http://localhost:3000")
        self.db_pool = db_pool
        self.cluster_id = cluster_id
        self.http_client = httpx.AsyncClient(timeout=30.0)
        self.ledger_id = 1  # NGN ledger
        
        self._account_cache: Dict[str, TigerBeetleAccount] = {}
        self._pending_transfers: Dict[str, TigerBeetleTransfer] = {}
    
    async def initialize(self):
        """Initialize the ledger and create system accounts"""
        if self.db_pool is None:
            self.db_pool = await asyncpg.create_pool(
                os.getenv("DATABASE_URL", "postgresql://localhost/remittance"),
                min_size=5,
                max_size=20
            )
        
        await self._create_schema()
        await self._create_system_accounts()
    
    async def _create_schema(self):
        """Create database schema for ledger tracking"""
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS tb_accounts (
                    id BIGINT PRIMARY KEY,
                    external_id VARCHAR(255) UNIQUE NOT NULL,
                    account_type INTEGER NOT NULL,
                    bank_code VARCHAR(10),
                    account_number VARCHAR(20),
                    currency VARCHAR(3) DEFAULT 'NGN',
                    description TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                );
                
                CREATE TABLE IF NOT EXISTS tb_transfers (
                    id BIGINT PRIMARY KEY,
                    external_id VARCHAR(255) UNIQUE NOT NULL,
                    debit_account_id BIGINT NOT NULL,
                    credit_account_id BIGINT NOT NULL,
                    amount BIGINT NOT NULL,
                    transfer_type INTEGER NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    pending_id BIGINT,
                    reference VARCHAR(255),
                    narration TEXT,
                    metadata JSONB DEFAULT '{}',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    committed_at TIMESTAMPTZ,
                    FOREIGN KEY (debit_account_id) REFERENCES tb_accounts(id),
                    FOREIGN KEY (credit_account_id) REFERENCES tb_accounts(id)
                );
                
                CREATE TABLE IF NOT EXISTS tb_balance_snapshots (
                    id SERIAL PRIMARY KEY,
                    account_id BIGINT NOT NULL,
                    debits_pending BIGINT NOT NULL,
                    debits_posted BIGINT NOT NULL,
                    credits_pending BIGINT NOT NULL,
                    credits_posted BIGINT NOT NULL,
                    available_balance BIGINT NOT NULL,
                    ledger_balance BIGINT NOT NULL,
                    snapshot_at TIMESTAMPTZ DEFAULT NOW(),
                    FOREIGN KEY (account_id) REFERENCES tb_accounts(id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_tb_accounts_bank ON tb_accounts(bank_code);
                CREATE INDEX IF NOT EXISTS idx_tb_accounts_type ON tb_accounts(account_type);
                CREATE INDEX IF NOT EXISTS idx_tb_transfers_status ON tb_transfers(status);
                CREATE INDEX IF NOT EXISTS idx_tb_transfers_debit ON tb_transfers(debit_account_id);
                CREATE INDEX IF NOT EXISTS idx_tb_transfers_credit ON tb_transfers(credit_account_id);
                CREATE INDEX IF NOT EXISTS idx_tb_balance_snapshots_account ON tb_balance_snapshots(account_id);
            """)
    
    async def _create_system_accounts(self):
        """Create system accounts for fees, suspense, etc."""
        system_accounts = [
            ("SYSTEM_FEE", AccountType.FEE_COLLECTION, "Fee Collection Account"),
            ("SYSTEM_SUSPENSE", AccountType.SUSPENSE, "Suspense Account"),
            ("SYSTEM_RECONCILIATION", AccountType.RECONCILIATION, "Reconciliation Account"),
            ("SYSTEM_SETTLEMENT", AccountType.SETTLEMENT, "Settlement Account"),
        ]
        
        for external_id, account_type, description in system_accounts:
            await self.create_account(
                external_id=external_id,
                account_type=account_type,
                description=description
            )
    
    def _generate_account_id(self, external_id: str) -> int:
        """Generate a unique 128-bit account ID from external ID"""
        hash_bytes = hashlib.sha256(external_id.encode()).digest()[:8]
        return struct.unpack('>Q', hash_bytes)[0]
    
    def _generate_transfer_id(self) -> int:
        """Generate a unique transfer ID"""
        return int(uuid.uuid4().int >> 64)
    
    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=10))
    async def _call_tigerbeetle(self, endpoint: str, data: Dict) -> Dict:
        """Make HTTP call to TigerBeetle API"""
        try:
            response = await self.http_client.post(
                f"{self.tigerbeetle_url}/{endpoint}",
                json=data,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            return response.json()
        except Exception as e:
            logger.error(f"TigerBeetle API error: {e}")
            raise
    
    async def create_account(
        self,
        external_id: str,
        account_type: AccountType,
        bank_code: str = None,
        account_number: str = None,
        description: str = None,
        metadata: Dict = None
    ) -> TigerBeetleAccount:
        """Create a new account in TigerBeetle"""
        account_id = self._generate_account_id(external_id)
        
        account = TigerBeetleAccount(
            id=account_id,
            ledger=self.ledger_id,
            code=account_type,
            user_data_128=external_id.encode()[:16].ljust(16, b'\x00'),
            user_data_64=int(time.time()),
            user_data_32=account_type
        )
        
        try:
            await self._call_tigerbeetle("create_accounts", {
                "accounts": [{
                    "id": account.id,
                    "ledger": account.ledger,
                    "code": account.code,
                    "flags": account.flags,
                    "user_data_128": account.user_data_128.hex(),
                    "user_data_64": account.user_data_64,
                    "user_data_32": account.user_data_32
                }]
            })
        except Exception as e:
            logger.warning(f"TigerBeetle create_account failed (may already exist): {e}")
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO tb_accounts (id, external_id, account_type, bank_code, account_number, description, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (external_id) DO UPDATE SET
                    bank_code = EXCLUDED.bank_code,
                    account_number = EXCLUDED.account_number,
                    description = EXCLUDED.description,
                    metadata = EXCLUDED.metadata
            """, account_id, external_id, account_type, bank_code, account_number, description, json.dumps(metadata or {}))
        
        self._account_cache[external_id] = account
        return account
    
    async def get_account(self, external_id: str) -> Optional[TigerBeetleAccount]:
        """Get account by external ID"""
        if external_id in self._account_cache:
            return self._account_cache[external_id]
        
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tb_accounts WHERE external_id = $1",
                external_id
            )
            
            if row:
                account = TigerBeetleAccount(
                    id=row['id'],
                    ledger=self.ledger_id,
                    code=row['account_type']
                )
                self._account_cache[external_id] = account
                return account
        
        return None
    
    async def get_balance(self, external_id: str) -> Dict[str, int]:
        """Get account balance from TigerBeetle"""
        account = await self.get_account(external_id)
        if not account:
            raise ValueError(f"Account not found: {external_id}")
        
        try:
            result = await self._call_tigerbeetle("lookup_accounts", {
                "account_ids": [account.id]
            })
            
            if result.get("accounts"):
                acc_data = result["accounts"][0]
                debits_pending = acc_data.get("debits_pending", 0)
                debits_posted = acc_data.get("debits_posted", 0)
                credits_pending = acc_data.get("credits_pending", 0)
                credits_posted = acc_data.get("credits_posted", 0)
                
                return {
                    "debits_pending": debits_pending,
                    "debits_posted": debits_posted,
                    "credits_pending": credits_pending,
                    "credits_posted": credits_posted,
                    "available_balance": credits_posted - debits_posted - debits_pending,
                    "ledger_balance": credits_posted - debits_posted
                }
        except Exception as e:
            logger.warning(f"TigerBeetle lookup failed, using DB: {e}")
        
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT 
                    COALESCE(SUM(CASE WHEN debit_account_id = $1 AND status = 'reserved' THEN amount ELSE 0 END), 0) as debits_pending,
                    COALESCE(SUM(CASE WHEN debit_account_id = $1 AND status = 'committed' THEN amount ELSE 0 END), 0) as debits_posted,
                    COALESCE(SUM(CASE WHEN credit_account_id = $1 AND status = 'reserved' THEN amount ELSE 0 END), 0) as credits_pending,
                    COALESCE(SUM(CASE WHEN credit_account_id = $1 AND status = 'committed' THEN amount ELSE 0 END), 0) as credits_posted
                FROM tb_transfers
                WHERE debit_account_id = $1 OR credit_account_id = $1
            """, account.id)
            
            debits_pending = row['debits_pending'] or 0
            debits_posted = row['debits_posted'] or 0
            credits_pending = row['credits_pending'] or 0
            credits_posted = row['credits_posted'] or 0
            
            return {
                "debits_pending": debits_pending,
                "debits_posted": debits_posted,
                "credits_pending": credits_pending,
                "credits_posted": credits_posted,
                "available_balance": credits_posted - debits_posted - debits_pending,
                "ledger_balance": credits_posted - debits_posted
            }
    
    async def reserve_transfer(
        self,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        transfer_type: TransferType,
        reference: str = None,
        narration: str = None,
        timeout_seconds: int = 300,
        metadata: Dict = None
    ) -> str:
        """Create a pending (reserved) transfer - Phase 1 of 2-phase commit"""
        debit_account = await self.get_account(debit_account_id)
        credit_account = await self.get_account(credit_account_id)
        
        if not debit_account or not credit_account:
            raise ValueError("Invalid account IDs")
        
        transfer_id = self._generate_transfer_id()
        external_id = str(uuid.uuid4())
        
        transfer = TigerBeetleTransfer(
            id=transfer_id,
            debit_account_id=debit_account.id,
            credit_account_id=credit_account.id,
            amount=amount,
            ledger=self.ledger_id,
            code=transfer_type,
            flags=1,  # pending flag
            timeout=timeout_seconds
        )
        
        try:
            await self._call_tigerbeetle("create_transfers", {
                "transfers": [{
                    "id": transfer.id,
                    "debit_account_id": transfer.debit_account_id,
                    "credit_account_id": transfer.credit_account_id,
                    "amount": transfer.amount,
                    "pending_id": 0,
                    "ledger": transfer.ledger,
                    "code": transfer.code,
                    "flags": transfer.flags,
                    "timeout": transfer.timeout
                }]
            })
        except Exception as e:
            logger.error(f"TigerBeetle reserve_transfer failed: {e}")
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO tb_transfers (id, external_id, debit_account_id, credit_account_id, amount, transfer_type, status, reference, narration, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """, transfer_id, external_id, debit_account.id, credit_account.id, amount, transfer_type, TransferStatus.RESERVED.value, reference, narration, json.dumps(metadata or {}))
        
        self._pending_transfers[external_id] = transfer
        
        return external_id
    
    async def commit_transfer(self, transfer_external_id: str) -> bool:
        """Commit a pending transfer - Phase 2 of 2-phase commit"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tb_transfers WHERE external_id = $1 AND status = $2",
                transfer_external_id, TransferStatus.RESERVED.value
            )
            
            if not row:
                raise ValueError(f"Pending transfer not found: {transfer_external_id}")
            
            transfer_id = row['id']
            
            commit_transfer = TigerBeetleTransfer(
                id=self._generate_transfer_id(),
                debit_account_id=row['debit_account_id'],
                credit_account_id=row['credit_account_id'],
                amount=row['amount'],
                pending_id=transfer_id,
                ledger=self.ledger_id,
                code=row['transfer_type'],
                flags=2  # post_pending_transfer flag
            )
            
            try:
                await self._call_tigerbeetle("create_transfers", {
                    "transfers": [{
                        "id": commit_transfer.id,
                        "debit_account_id": commit_transfer.debit_account_id,
                        "credit_account_id": commit_transfer.credit_account_id,
                        "amount": commit_transfer.amount,
                        "pending_id": commit_transfer.pending_id,
                        "ledger": commit_transfer.ledger,
                        "code": commit_transfer.code,
                        "flags": commit_transfer.flags
                    }]
                })
            except Exception as e:
                logger.error(f"TigerBeetle commit_transfer failed: {e}")
            
            await conn.execute("""
                UPDATE tb_transfers SET status = $1, committed_at = NOW()
                WHERE external_id = $2
            """, TransferStatus.COMMITTED.value, transfer_external_id)
        
        if transfer_external_id in self._pending_transfers:
            del self._pending_transfers[transfer_external_id]
        
        return True
    
    async def abort_transfer(self, transfer_external_id: str) -> bool:
        """Abort a pending transfer"""
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tb_transfers WHERE external_id = $1 AND status = $2",
                transfer_external_id, TransferStatus.RESERVED.value
            )
            
            if not row:
                raise ValueError(f"Pending transfer not found: {transfer_external_id}")
            
            transfer_id = row['id']
            
            void_transfer = TigerBeetleTransfer(
                id=self._generate_transfer_id(),
                debit_account_id=row['debit_account_id'],
                credit_account_id=row['credit_account_id'],
                amount=row['amount'],
                pending_id=transfer_id,
                ledger=self.ledger_id,
                code=row['transfer_type'],
                flags=4  # void_pending_transfer flag
            )
            
            try:
                await self._call_tigerbeetle("create_transfers", {
                    "transfers": [{
                        "id": void_transfer.id,
                        "debit_account_id": void_transfer.debit_account_id,
                        "credit_account_id": void_transfer.credit_account_id,
                        "amount": void_transfer.amount,
                        "pending_id": void_transfer.pending_id,
                        "ledger": void_transfer.ledger,
                        "code": void_transfer.code,
                        "flags": void_transfer.flags
                    }]
                })
            except Exception as e:
                logger.error(f"TigerBeetle abort_transfer failed: {e}")
            
            await conn.execute("""
                UPDATE tb_transfers SET status = $1
                WHERE external_id = $2
            """, TransferStatus.ABORTED.value, transfer_external_id)
        
        if transfer_external_id in self._pending_transfers:
            del self._pending_transfers[transfer_external_id]
        
        return True
    
    async def post_transfer(
        self,
        debit_account_id: str,
        credit_account_id: str,
        amount: int,
        transfer_type: TransferType,
        reference: str = None,
        narration: str = None,
        metadata: Dict = None
    ) -> str:
        """Post a transfer immediately (single-phase)"""
        debit_account = await self.get_account(debit_account_id)
        credit_account = await self.get_account(credit_account_id)
        
        if not debit_account or not credit_account:
            raise ValueError("Invalid account IDs")
        
        transfer_id = self._generate_transfer_id()
        external_id = str(uuid.uuid4())
        
        transfer = TigerBeetleTransfer(
            id=transfer_id,
            debit_account_id=debit_account.id,
            credit_account_id=credit_account.id,
            amount=amount,
            ledger=self.ledger_id,
            code=transfer_type,
            flags=0  # No flags = immediate post
        )
        
        try:
            await self._call_tigerbeetle("create_transfers", {
                "transfers": [{
                    "id": transfer.id,
                    "debit_account_id": transfer.debit_account_id,
                    "credit_account_id": transfer.credit_account_id,
                    "amount": transfer.amount,
                    "pending_id": 0,
                    "ledger": transfer.ledger,
                    "code": transfer.code,
                    "flags": transfer.flags
                }]
            })
        except Exception as e:
            logger.error(f"TigerBeetle post_transfer failed: {e}")
        
        async with self.db_pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO tb_transfers (id, external_id, debit_account_id, credit_account_id, amount, transfer_type, status, reference, narration, metadata, committed_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            """, transfer_id, external_id, debit_account.id, credit_account.id, amount, transfer_type, TransferStatus.COMMITTED.value, reference, narration, json.dumps(metadata or {}))
        
        return external_id
    
    async def get_transfer_history(
        self,
        account_external_id: str,
        start_date: datetime = None,
        end_date: datetime = None,
        limit: int = 100
    ) -> List[Dict]:
        """Get transfer history for an account"""
        account = await self.get_account(account_external_id)
        if not account:
            raise ValueError(f"Account not found: {account_external_id}")
        
        async with self.db_pool.acquire() as conn:
            query = """
                SELECT t.*, 
                       da.external_id as debit_account_name,
                       ca.external_id as credit_account_name
                FROM tb_transfers t
                JOIN tb_accounts da ON t.debit_account_id = da.id
                JOIN tb_accounts ca ON t.credit_account_id = ca.id
                WHERE (t.debit_account_id = $1 OR t.credit_account_id = $1)
            """
            params = [account.id]
            
            if start_date:
                query += f" AND t.created_at >= ${len(params) + 1}"
                params.append(start_date)
            
            if end_date:
                query += f" AND t.created_at <= ${len(params) + 1}"
                params.append(end_date)
            
            query += f" ORDER BY t.created_at DESC LIMIT ${len(params) + 1}"
            params.append(limit)
            
            rows = await conn.fetch(query, *params)
            
            return [dict(row) for row in rows]
    
    async def create_bank_float_account(
        self,
        bank_code: str,
        account_number: str,
        bank_name: str,
        initial_balance: int = 0
    ) -> str:
        """Create a bank float account for multi-bank routing"""
        external_id = f"BANK_FLOAT_{bank_code}_{account_number}"
        
        await self.create_account(
            external_id=external_id,
            account_type=AccountType.BANK_FLOAT,
            bank_code=bank_code,
            account_number=account_number,
            description=f"Float account at {bank_name}",
            metadata={"bank_name": bank_name}
        )
        
        if initial_balance > 0:
            await self.post_transfer(
                debit_account_id="SYSTEM_SETTLEMENT",
                credit_account_id=external_id,
                amount=initial_balance,
                transfer_type=TransferType.ADJUSTMENT,
                narration=f"Initial funding for {bank_name} float account"
            )
        
        return external_id
    
    async def record_payout(
        self,
        source_bank_code: str,
        source_account_number: str,
        amount: int,
        reference: str,
        narration: str = None
    ) -> str:
        """Record a payout from a bank float account"""
        source_external_id = f"BANK_FLOAT_{source_bank_code}_{source_account_number}"
        
        return await self.reserve_transfer(
            debit_account_id=source_external_id,
            credit_account_id="SYSTEM_SETTLEMENT",
            amount=amount,
            transfer_type=TransferType.PAYOUT,
            reference=reference,
            narration=narration
        )
    
    async def record_collection(
        self,
        dest_bank_code: str,
        dest_account_number: str,
        amount: int,
        reference: str,
        narration: str = None
    ) -> str:
        """Record a collection into a bank float account"""
        dest_external_id = f"BANK_FLOAT_{dest_bank_code}_{dest_account_number}"
        
        return await self.post_transfer(
            debit_account_id="SYSTEM_SETTLEMENT",
            credit_account_id=dest_external_id,
            amount=amount,
            transfer_type=TransferType.COLLECTION,
            reference=reference,
            narration=narration
        )
    
    async def record_sweep(
        self,
        source_bank_code: str,
        source_account_number: str,
        dest_bank_code: str,
        dest_account_number: str,
        amount: int,
        reference: str
    ) -> str:
        """Record a sweep between bank float accounts"""
        source_external_id = f"BANK_FLOAT_{source_bank_code}_{source_account_number}"
        dest_external_id = f"BANK_FLOAT_{dest_bank_code}_{dest_account_number}"
        
        return await self.post_transfer(
            debit_account_id=source_external_id,
            credit_account_id=dest_external_id,
            amount=amount,
            transfer_type=TransferType.SWEEP,
            reference=reference,
            narration=f"Liquidity sweep from {source_bank_code} to {dest_bank_code}"
        )
    
    async def get_all_bank_balances(self) -> List[Dict]:
        """Get balances for all bank float accounts"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("""
                SELECT external_id, bank_code, account_number, description, metadata
                FROM tb_accounts
                WHERE account_type = $1
            """, AccountType.BANK_FLOAT)
            
            balances = []
            for row in rows:
                balance = await self.get_balance(row['external_id'])
                balances.append({
                    "external_id": row['external_id'],
                    "bank_code": row['bank_code'],
                    "account_number": row['account_number'],
                    "description": row['description'],
                    **balance
                })
            
            return balances
    
    async def snapshot_balances(self):
        """Take a snapshot of all account balances"""
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT id, external_id FROM tb_accounts")
            
            for row in rows:
                balance = await self.get_balance(row['external_id'])
                await conn.execute("""
                    INSERT INTO tb_balance_snapshots (account_id, debits_pending, debits_posted, credits_pending, credits_posted, available_balance, ledger_balance)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                """, row['id'], balance['debits_pending'], balance['debits_posted'], balance['credits_pending'], balance['credits_posted'], balance['available_balance'], balance['ledger_balance'])
    
    async def close(self):
        """Close connections"""
        await self.http_client.aclose()
        if self.db_pool:
            await self.db_pool.close()


# Singleton instance
_ledger_instance: Optional[TigerBeetleLedger] = None


async def get_ledger() -> TigerBeetleLedger:
    """Get or create the TigerBeetle ledger instance"""
    global _ledger_instance
    if _ledger_instance is None:
        _ledger_instance = TigerBeetleLedger()
        await _ledger_instance.initialize()
    return _ledger_instance
