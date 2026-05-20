"""
Property-based and Invariant Tests for Financial Operations

These tests verify critical financial invariants that must hold for a banking platform:
1. Double-entry accounting: sum of debits == sum of credits
2. Idempotency: same transaction ID doesn't create duplicate postings
3. Non-negative balances (where required)
4. Monotonicity of transaction IDs
5. Reconciliation: ledger balance matches computed balance from transaction history
"""

import pytest
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Dict, Any
from dataclasses import dataclass
from enum import Enum
import uuid
import random
from datetime import datetime, timedelta


class TransactionType(Enum):
    DEBIT = "debit"
    CREDIT = "credit"


@dataclass
class LedgerEntry:
    """Represents a single ledger entry"""
    entry_id: str
    transaction_id: str
    account_id: str
    entry_type: TransactionType
    amount: Decimal
    timestamp: datetime
    
    def __post_init__(self):
        if self.amount < 0:
            raise ValueError("Amount must be non-negative")


@dataclass
class Transaction:
    """Represents a double-entry transaction"""
    transaction_id: str
    entries: List[LedgerEntry]
    idempotency_key: str
    timestamp: datetime
    
    def validate_double_entry(self) -> bool:
        """Validate that debits equal credits"""
        total_debits = sum(
            e.amount for e in self.entries 
            if e.entry_type == TransactionType.DEBIT
        )
        total_credits = sum(
            e.amount for e in self.entries 
            if e.entry_type == TransactionType.CREDIT
        )
        return total_debits == total_credits


class MockLedger:
    """Mock ledger for testing financial invariants"""
    
    def __init__(self):
        self.entries: List[LedgerEntry] = []
        self.transactions: Dict[str, Transaction] = {}
        self.processed_idempotency_keys: set = set()
        self.account_balances: Dict[str, Decimal] = {}
        self.initial_balances: Dict[str, Decimal] = {}  # Track initial balances for reconciliation
    
    def create_account(self, account_id: str, initial_balance: Decimal = Decimal("0")):
        """Create a new account with optional initial balance"""
        self.account_balances[account_id] = initial_balance
        self.initial_balances[account_id] = initial_balance  # Store initial balance
    
    def post_transaction(self, transaction: Transaction) -> bool:
        """Post a transaction to the ledger with idempotency check"""
        # Idempotency check
        if transaction.idempotency_key in self.processed_idempotency_keys:
            return False  # Already processed
        
        # Validate double-entry
        if not transaction.validate_double_entry():
            raise ValueError("Transaction violates double-entry principle")
        
        # Process entries
        for entry in transaction.entries:
            self.entries.append(entry)
            
            # Update account balance
            if entry.account_id not in self.account_balances:
                self.account_balances[entry.account_id] = Decimal("0")
            
            if entry.entry_type == TransactionType.DEBIT:
                self.account_balances[entry.account_id] -= entry.amount
            else:
                self.account_balances[entry.account_id] += entry.amount
        
        self.transactions[transaction.transaction_id] = transaction
        self.processed_idempotency_keys.add(transaction.idempotency_key)
        return True
    
    def get_balance(self, account_id: str) -> Decimal:
        """Get current balance for an account"""
        return self.account_balances.get(account_id, Decimal("0"))
    
    def compute_balance_from_history(self, account_id: str) -> Decimal:
        """Compute balance by replaying all entries from initial balance"""
        # Start with initial balance (stored when account was created)
        balance = self.initial_balances.get(account_id, Decimal("0"))
        for entry in self.entries:
            if entry.account_id == account_id:
                if entry.entry_type == TransactionType.CREDIT:
                    balance += entry.amount
                else:
                    balance -= entry.amount
        return balance
    
    def get_total_debits(self) -> Decimal:
        """Get sum of all debits in the ledger"""
        return sum(
            e.amount for e in self.entries 
            if e.entry_type == TransactionType.DEBIT
        )
    
    def get_total_credits(self) -> Decimal:
        """Get sum of all credits in the ledger"""
        return sum(
            e.amount for e in self.entries 
            if e.entry_type == TransactionType.CREDIT
        )


class TestDoubleEntryInvariant:
    """Test double-entry accounting invariant"""
    
    @pytest.fixture
    def ledger(self):
        """Create a fresh ledger for each test"""
        return MockLedger()
    
    def test_single_transfer_maintains_balance(self, ledger):
        """A single transfer should maintain double-entry balance"""
        ledger.create_account("agent_001", Decimal("10000"))
        ledger.create_account("customer_001", Decimal("0"))
        
        transaction = Transaction(
            transaction_id=str(uuid.uuid4()),
            idempotency_key=str(uuid.uuid4()),
            timestamp=datetime.now(),
            entries=[
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="agent_001",
                    entry_type=TransactionType.DEBIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="customer_001",
                    entry_type=TransactionType.CREDIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                )
            ]
        )
        
        ledger.post_transaction(transaction)
        
        # Invariant: total debits == total credits
        assert ledger.get_total_debits() == ledger.get_total_credits()
    
    @pytest.mark.parametrize("num_transactions", [10, 50, 100])
    def test_multiple_transfers_maintain_balance(self, ledger, num_transactions):
        """Multiple random transfers should maintain double-entry balance"""
        accounts = [f"account_{i}" for i in range(10)]
        for acc in accounts:
            ledger.create_account(acc, Decimal("100000"))
        
        for _ in range(num_transactions):
            from_acc = random.choice(accounts)
            to_acc = random.choice([a for a in accounts if a != from_acc])
            amount = Decimal(str(random.randint(1, 1000)))
            
            transaction = Transaction(
                transaction_id=str(uuid.uuid4()),
                idempotency_key=str(uuid.uuid4()),
                timestamp=datetime.now(),
                entries=[
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id=from_acc,
                        entry_type=TransactionType.DEBIT,
                        amount=amount,
                        timestamp=datetime.now()
                    ),
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id=to_acc,
                        entry_type=TransactionType.CREDIT,
                        amount=amount,
                        timestamp=datetime.now()
                    )
                ]
            )
            ledger.post_transaction(transaction)
        
        # Invariant: total debits == total credits after all transactions
        assert ledger.get_total_debits() == ledger.get_total_credits()
    
    def test_invalid_transaction_rejected(self, ledger):
        """Transaction with unbalanced entries should be rejected"""
        transaction = Transaction(
            transaction_id=str(uuid.uuid4()),
            idempotency_key=str(uuid.uuid4()),
            timestamp=datetime.now(),
            entries=[
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="agent_001",
                    entry_type=TransactionType.DEBIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="customer_001",
                    entry_type=TransactionType.CREDIT,
                    amount=Decimal("500"),  # Unbalanced!
                    timestamp=datetime.now()
                )
            ]
        )
        
        with pytest.raises(ValueError, match="double-entry"):
            ledger.post_transaction(transaction)


class TestIdempotencyInvariant:
    """Test transaction idempotency invariant"""
    
    @pytest.fixture
    def ledger(self):
        return MockLedger()
    
    def test_duplicate_transaction_rejected(self, ledger):
        """Same idempotency key should not create duplicate entries"""
        ledger.create_account("agent_001", Decimal("10000"))
        ledger.create_account("customer_001", Decimal("0"))
        
        idempotency_key = str(uuid.uuid4())
        
        transaction1 = Transaction(
            transaction_id=str(uuid.uuid4()),
            idempotency_key=idempotency_key,
            timestamp=datetime.now(),
            entries=[
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="agent_001",
                    entry_type=TransactionType.DEBIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="customer_001",
                    entry_type=TransactionType.CREDIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                )
            ]
        )
        
        # First submission should succeed
        result1 = ledger.post_transaction(transaction1)
        assert result1 is True
        
        # Duplicate with same idempotency key should be rejected
        transaction2 = Transaction(
            transaction_id=str(uuid.uuid4()),  # Different transaction ID
            idempotency_key=idempotency_key,   # Same idempotency key
            timestamp=datetime.now(),
            entries=[
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="agent_001",
                    entry_type=TransactionType.DEBIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="customer_001",
                    entry_type=TransactionType.CREDIT,
                    amount=Decimal("1000"),
                    timestamp=datetime.now()
                )
            ]
        )
        
        result2 = ledger.post_transaction(transaction2)
        assert result2 is False
        
        # Balance should only reflect one transaction
        assert ledger.get_balance("agent_001") == Decimal("9000")
        assert ledger.get_balance("customer_001") == Decimal("1000")


class TestReconciliationInvariant:
    """Test balance reconciliation invariant"""
    
    @pytest.fixture
    def ledger(self):
        return MockLedger()
    
    def test_balance_matches_history(self, ledger):
        """Stored balance should match computed balance from history"""
        ledger.create_account("agent_001", Decimal("10000"))
        ledger.create_account("customer_001", Decimal("5000"))
        
        # Perform several transactions
        for i in range(20):
            amount = Decimal(str(random.randint(100, 500)))
            transaction = Transaction(
                transaction_id=str(uuid.uuid4()),
                idempotency_key=str(uuid.uuid4()),
                timestamp=datetime.now(),
                entries=[
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id="agent_001",
                        entry_type=TransactionType.DEBIT,
                        amount=amount,
                        timestamp=datetime.now()
                    ),
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id="customer_001",
                        entry_type=TransactionType.CREDIT,
                        amount=amount,
                        timestamp=datetime.now()
                    )
                ]
            )
            ledger.post_transaction(transaction)
        
        # Invariant: stored balance == computed balance from history
        for account_id in ["agent_001", "customer_001"]:
            stored_balance = ledger.get_balance(account_id)
            computed_balance = ledger.compute_balance_from_history(account_id)
            assert stored_balance == computed_balance, \
                f"Balance mismatch for {account_id}: stored={stored_balance}, computed={computed_balance}"


class TestAmountInvariants:
    """Test amount-related invariants"""
    
    def test_negative_amount_rejected(self):
        """Negative amounts should be rejected"""
        with pytest.raises(ValueError, match="non-negative"):
            LedgerEntry(
                entry_id=str(uuid.uuid4()),
                transaction_id="",
                account_id="test",
                entry_type=TransactionType.DEBIT,
                amount=Decimal("-100"),
                timestamp=datetime.now()
            )
    
    def test_zero_amount_allowed(self):
        """Zero amounts should be allowed (for fee-free transactions)"""
        entry = LedgerEntry(
            entry_id=str(uuid.uuid4()),
            transaction_id="",
            account_id="test",
            entry_type=TransactionType.DEBIT,
            amount=Decimal("0"),
            timestamp=datetime.now()
        )
        assert entry.amount == Decimal("0")
    
    @pytest.mark.parametrize("amount_str", [
        "0.01",
        "100.00",
        "999999.99",
        "0.001",  # Sub-cent precision
    ])
    def test_decimal_precision_preserved(self, amount_str):
        """Decimal precision should be preserved"""
        amount = Decimal(amount_str)
        entry = LedgerEntry(
            entry_id=str(uuid.uuid4()),
            transaction_id="",
            account_id="test",
            entry_type=TransactionType.CREDIT,
            amount=amount,
            timestamp=datetime.now()
        )
        assert entry.amount == amount


class TestAgentBankingInvariants:
    """Test remittance specific invariants"""
    
    @pytest.fixture
    def ledger(self):
        return MockLedger()
    
    def test_float_account_conservation(self, ledger):
        """Float account total should be conserved across agent network"""
        # Create master agent and sub-agents
        ledger.create_account("master_float", Decimal("1000000"))
        ledger.create_account("super_agent_1_float", Decimal("0"))
        ledger.create_account("super_agent_2_float", Decimal("0"))
        ledger.create_account("agent_1_float", Decimal("0"))
        ledger.create_account("agent_2_float", Decimal("0"))
        
        initial_total = sum(ledger.account_balances.values())
        
        # Distribute float from master to super agents
        for super_agent in ["super_agent_1_float", "super_agent_2_float"]:
            transaction = Transaction(
                transaction_id=str(uuid.uuid4()),
                idempotency_key=str(uuid.uuid4()),
                timestamp=datetime.now(),
                entries=[
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id="master_float",
                        entry_type=TransactionType.DEBIT,
                        amount=Decimal("100000"),
                        timestamp=datetime.now()
                    ),
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id=super_agent,
                        entry_type=TransactionType.CREDIT,
                        amount=Decimal("100000"),
                        timestamp=datetime.now()
                    )
                ]
            )
            ledger.post_transaction(transaction)
        
        # Distribute from super agents to agents
        for agent, super_agent in [("agent_1_float", "super_agent_1_float"), 
                                    ("agent_2_float", "super_agent_2_float")]:
            transaction = Transaction(
                transaction_id=str(uuid.uuid4()),
                idempotency_key=str(uuid.uuid4()),
                timestamp=datetime.now(),
                entries=[
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id=super_agent,
                        entry_type=TransactionType.DEBIT,
                        amount=Decimal("50000"),
                        timestamp=datetime.now()
                    ),
                    LedgerEntry(
                        entry_id=str(uuid.uuid4()),
                        transaction_id="",
                        account_id=agent,
                        entry_type=TransactionType.CREDIT,
                        amount=Decimal("50000"),
                        timestamp=datetime.now()
                    )
                ]
            )
            ledger.post_transaction(transaction)
        
        # Invariant: total float is conserved
        final_total = sum(ledger.account_balances.values())
        assert initial_total == final_total, \
            f"Float not conserved: initial={initial_total}, final={final_total}"
    
    def test_commission_calculation_invariant(self, ledger):
        """Commission should be correctly split between agent tiers"""
        # Create accounts for commission distribution
        ledger.create_account("platform_revenue", Decimal("0"))
        ledger.create_account("master_agent_commission", Decimal("0"))
        ledger.create_account("super_agent_commission", Decimal("0"))
        ledger.create_account("agent_commission", Decimal("0"))
        ledger.create_account("customer_fee_source", Decimal("100"))  # Fee collected
        
        # Commission split: Platform 20%, Master 30%, Super 25%, Agent 25%
        total_fee = Decimal("100")
        platform_share = total_fee * Decimal("0.20")
        master_share = total_fee * Decimal("0.30")
        super_share = total_fee * Decimal("0.25")
        agent_share = total_fee * Decimal("0.25")
        
        # Create commission distribution transaction
        transaction = Transaction(
            transaction_id=str(uuid.uuid4()),
            idempotency_key=str(uuid.uuid4()),
            timestamp=datetime.now(),
            entries=[
                # Debit from fee source
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="customer_fee_source",
                    entry_type=TransactionType.DEBIT,
                    amount=total_fee,
                    timestamp=datetime.now()
                ),
                # Credit to each tier
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="platform_revenue",
                    entry_type=TransactionType.CREDIT,
                    amount=platform_share,
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="master_agent_commission",
                    entry_type=TransactionType.CREDIT,
                    amount=master_share,
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="super_agent_commission",
                    entry_type=TransactionType.CREDIT,
                    amount=super_share,
                    timestamp=datetime.now()
                ),
                LedgerEntry(
                    entry_id=str(uuid.uuid4()),
                    transaction_id="",
                    account_id="agent_commission",
                    entry_type=TransactionType.CREDIT,
                    amount=agent_share,
                    timestamp=datetime.now()
                ),
            ]
        )
        
        ledger.post_transaction(transaction)
        
        # Invariant: commission shares sum to total fee
        total_distributed = (
            ledger.get_balance("platform_revenue") +
            ledger.get_balance("master_agent_commission") +
            ledger.get_balance("super_agent_commission") +
            ledger.get_balance("agent_commission")
        )
        assert total_distributed == total_fee, \
            f"Commission not fully distributed: {total_distributed} != {total_fee}"
