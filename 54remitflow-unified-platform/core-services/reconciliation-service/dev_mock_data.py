"""
Development-only mock data generation for reconciliation testing.

This module is ONLY for development/testing purposes and should NOT be used in production.
The main.py module will fail fast if USE_MOCK_DATA=true is set in production environment.
"""

from datetime import datetime, date, timedelta
from typing import List
import uuid
import random


def generate_mock_reconciliation_data(
    corridor_value: str,
    start_date: date,
    end_date: date,
    TransactionRecord,
    LedgerRecord,
    ProviderRecord
):
    """
    Generate mock data for reconciliation testing (development only).
    
    Args:
        corridor_value: The corridor type value (string)
        start_date: Start date for mock data
        end_date: End date for mock data
        TransactionRecord: The TransactionRecord model class
        LedgerRecord: The LedgerRecord model class
        ProviderRecord: The ProviderRecord model class
    
    Returns:
        Tuple of (transactions, ledger_records, provider_records)
    """
    transactions = []
    for i in range(100):
        txn_date = start_date + timedelta(days=random.randint(0, max(1, (end_date - start_date).days)))
        transactions.append(TransactionRecord(
            transaction_id=f"TXN-{uuid.uuid4().hex[:8].upper()}",
            reference=f"REF-{uuid.uuid4().hex[:8].upper()}",
            amount=random.uniform(1000, 500000),
            currency="NGN",
            status=random.choice(["completed", "completed", "completed", "pending", "failed"]),
            created_at=datetime.combine(txn_date, datetime.min.time()),
            completed_at=datetime.combine(txn_date, datetime.min.time()) if random.random() > 0.1 else None,
            corridor=corridor_value
        ))
    
    ledger_records = []
    for txn in transactions[:95]:
        ledger_records.append(LedgerRecord(
            ledger_id=f"LED-{uuid.uuid4().hex[:8].upper()}",
            transaction_id=txn.transaction_id,
            debit_account="WALLET-001",
            credit_account="SETTLEMENT-001",
            amount=txn.amount if random.random() > 0.05 else txn.amount * 1.01,
            currency=txn.currency,
            timestamp=txn.created_at,
            pending=txn.status == "pending"
        ))
    
    provider_records = []
    for txn in transactions[:90]:
        provider_records.append(ProviderRecord(
            provider_reference=f"PRV-{uuid.uuid4().hex[:8].upper()}",
            internal_reference=txn.reference,
            amount=txn.amount if random.random() > 0.03 else txn.amount * 0.99,
            currency=txn.currency,
            status="settled" if txn.status == "completed" else txn.status,
            settlement_date=txn.created_at
        ))
    
    return transactions, ledger_records, provider_records
