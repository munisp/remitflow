"""
Transaction Monitor - Real-time monitoring and reconciliation
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict
from enum import Enum

logger = logging.getLogger(__name__)


class TransactionType(str, Enum):
    """Transaction types"""
    CREDIT = "credit"
    DEBIT = "debit"


class TransactionStatus(str, Enum):
    """Transaction status"""
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"
    REVERSED = "reversed"


class TransactionMonitor:
    """Monitors and reconciles virtual account transactions"""
    
    def __init__(self):
        self.transactions: List[Dict] = []
        self.pending_credits: Dict[str, Dict] = {}
        self.reconciliation_issues: List[Dict] = []
        logger.info("Transaction monitor initialized")
    
    def record_transaction(
        self,
        account_id: str,
        account_number: str,
        transaction_type: TransactionType,
        amount: Decimal,
        reference: str,
        narration: str,
        sender_name: Optional[str] = None,
        sender_account: Optional[str] = None,
        sender_bank: Optional[str] = None
    ) -> Dict:
        """Record new transaction"""
        
        transaction = {
            "transaction_id": f"TXN{len(self.transactions) + 1:08d}",
            "account_id": account_id,
            "account_number": account_number,
            "type": transaction_type.value,
            "amount": float(amount),
            "reference": reference,
            "narration": narration,
            "sender_name": sender_name,
            "sender_account": sender_account,
            "sender_bank": sender_bank,
            "status": TransactionStatus.COMPLETED.value,
            "created_at": datetime.utcnow().isoformat(),
            "processed_at": datetime.utcnow().isoformat()
        }
        
        self.transactions.append(transaction)
        logger.info(f"Transaction recorded: {transaction['transaction_id']}")
        
        return transaction
    
    def get_account_transactions(
        self,
        account_id: str,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        transaction_type: Optional[TransactionType] = None
    ) -> List[Dict]:
        """Get transactions for account"""
        
        filtered = [
            t for t in self.transactions
            if t["account_id"] == account_id
        ]
        
        if start_date:
            filtered = [
                t for t in filtered
                if datetime.fromisoformat(t["created_at"]) >= start_date
            ]
        
        if end_date:
            filtered = [
                t for t in filtered
                if datetime.fromisoformat(t["created_at"]) <= end_date
            ]
        
        if transaction_type:
            filtered = [
                t for t in filtered
                if t["type"] == transaction_type.value
            ]
        
        return sorted(filtered, key=lambda x: x["created_at"], reverse=True)
    
    def get_account_balance(self, account_id: str) -> Decimal:
        """Calculate account balance from transactions"""
        
        account_txns = [
            t for t in self.transactions
            if t["account_id"] == account_id
        ]
        
        balance = Decimal("0")
        for txn in account_txns:
            amount = Decimal(str(txn["amount"]))
            if txn["type"] == TransactionType.CREDIT.value:
                balance += amount
            elif txn["type"] == TransactionType.DEBIT.value:
                balance -= amount
        
        return balance
    
    def get_transaction_statistics(
        self,
        account_id: str,
        days: int = 30
    ) -> Dict:
        """Get transaction statistics for account"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        account_txns = [
            t for t in self.transactions
            if t["account_id"] == account_id and
            datetime.fromisoformat(t["created_at"]) >= cutoff
        ]
        
        if not account_txns:
            return {
                "account_id": account_id,
                "period_days": days,
                "total_transactions": 0
            }
        
        credits = [t for t in account_txns if t["type"] == TransactionType.CREDIT.value]
        debits = [t for t in account_txns if t["type"] == TransactionType.DEBIT.value]
        
        total_credits = sum(Decimal(str(t["amount"])) for t in credits)
        total_debits = sum(Decimal(str(t["amount"])) for t in debits)
        
        return {
            "account_id": account_id,
            "period_days": days,
            "total_transactions": len(account_txns),
            "credit_count": len(credits),
            "debit_count": len(debits),
            "total_credits": float(total_credits),
            "total_debits": float(total_debits),
            "net_flow": float(total_credits - total_debits),
            "average_credit": float(total_credits / len(credits)) if credits else 0,
            "average_debit": float(total_debits / len(debits)) if debits else 0
        }
    
    def get_top_senders(
        self,
        account_id: str,
        days: int = 30,
        limit: int = 10
    ) -> List[Dict]:
        """Get top senders to account"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        credits = [
            t for t in self.transactions
            if t["account_id"] == account_id and
            t["type"] == TransactionType.CREDIT.value and
            datetime.fromisoformat(t["created_at"]) >= cutoff and
            t.get("sender_name")
        ]
        
        sender_totals = defaultdict(lambda: {"count": 0, "total": Decimal("0")})
        sender_info = {}
        
        for txn in credits:
            sender = txn["sender_name"]
            amount = Decimal(str(txn["amount"]))
            
            sender_totals[sender]["count"] += 1
            sender_totals[sender]["total"] += amount
            
            if sender not in sender_info:
                sender_info[sender] = {
                    "sender_name": sender,
                    "sender_account": txn.get("sender_account"),
                    "sender_bank": txn.get("sender_bank")
                }
        
        top_senders = []
        for sender, data in sorted(
            sender_totals.items(),
            key=lambda x: x[1]["total"],
            reverse=True
        )[:limit]:
            info = sender_info[sender]
            info["transaction_count"] = data["count"]
            info["total_amount"] = float(data["total"])
            top_senders.append(info)
        
        return top_senders
    
    def detect_suspicious_transactions(
        self,
        account_id: str,
        threshold_amount: Decimal = Decimal("1000000"),  # 1M NGN
        days: int = 7
    ) -> List[Dict]:
        """Detect potentially suspicious transactions"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent_txns = [
            t for t in self.transactions
            if t["account_id"] == account_id and
            datetime.fromisoformat(t["created_at"]) >= cutoff
        ]
        
        suspicious = []
        
        for txn in recent_txns:
            amount = Decimal(str(txn["amount"]))
            flags = []
            
            # Large amount
            if amount >= threshold_amount:
                flags.append("large_amount")
            
            # Round numbers (potential test)
            if amount % Decimal("1000") == 0 and amount >= Decimal("10000"):
                flags.append("round_number")
            
            # Missing sender info
            if txn["type"] == TransactionType.CREDIT.value:
                if not txn.get("sender_name"):
                    flags.append("missing_sender_info")
            
            if flags:
                suspicious.append({
                    **txn,
                    "flags": flags,
                    "risk_level": "high" if "large_amount" in flags else "medium"
                })
        
        return suspicious
    
    def reconcile_transactions(
        self,
        account_id: str,
        expected_balance: Decimal,
        provider_transactions: List[Dict]
    ) -> Dict:
        """Reconcile internal transactions with provider"""
        
        # Get internal transactions
        internal_txns = self.get_account_transactions(account_id)
        internal_balance = self.get_account_balance(account_id)
        
        # Compare balances
        balance_match = abs(internal_balance - expected_balance) < Decimal("0.01")
        
        # Compare transaction counts
        internal_count = len(internal_txns)
        provider_count = len(provider_transactions)
        count_match = internal_count == provider_count
        
        # Find missing transactions
        internal_refs = {t["reference"] for t in internal_txns}
        provider_refs = {t["reference"] for t in provider_transactions}
        
        missing_in_internal = provider_refs - internal_refs
        missing_in_provider = internal_refs - provider_refs
        
        reconciliation = {
            "account_id": account_id,
            "reconciled_at": datetime.utcnow().isoformat(),
            "balance_match": balance_match,
            "internal_balance": float(internal_balance),
            "expected_balance": float(expected_balance),
            "balance_difference": float(expected_balance - internal_balance),
            "count_match": count_match,
            "internal_count": internal_count,
            "provider_count": provider_count,
            "missing_in_internal": list(missing_in_internal),
            "missing_in_provider": list(missing_in_provider),
            "status": "matched" if (balance_match and count_match) else "mismatch"
        }
        
        if reconciliation["status"] == "mismatch":
            self.reconciliation_issues.append(reconciliation)
            logger.warning(f"Reconciliation mismatch for account {account_id}")
        
        return reconciliation
    
    def get_reconciliation_issues(self, limit: int = 50) -> List[Dict]:
        """Get recent reconciliation issues"""
        return self.reconciliation_issues[-limit:]
    
    def get_daily_summary(
        self,
        account_id: str,
        date: datetime
    ) -> Dict:
        """Get daily transaction summary"""
        
        start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        day_txns = [
            t for t in self.transactions
            if t["account_id"] == account_id and
            start_of_day <= datetime.fromisoformat(t["created_at"]) < end_of_day
        ]
        
        credits = [t for t in day_txns if t["type"] == TransactionType.CREDIT.value]
        debits = [t for t in day_txns if t["type"] == TransactionType.DEBIT.value]
        
        total_credits = sum(Decimal(str(t["amount"])) for t in credits)
        total_debits = sum(Decimal(str(t["amount"])) for t in debits)
        
        return {
            "account_id": account_id,
            "date": date.date().isoformat(),
            "total_transactions": len(day_txns),
            "credit_count": len(credits),
            "debit_count": len(debits),
            "total_credits": float(total_credits),
            "total_debits": float(total_debits),
            "net_flow": float(total_credits - total_debits)
        }
    
    def get_overall_statistics(self) -> Dict:
        """Get overall transaction statistics"""
        
        if not self.transactions:
            return {"total_transactions": 0}
        
        total_credits = sum(
            Decimal(str(t["amount"]))
            for t in self.transactions
            if t["type"] == TransactionType.CREDIT.value
        )
        
        total_debits = sum(
            Decimal(str(t["amount"]))
            for t in self.transactions
            if t["type"] == TransactionType.DEBIT.value
        )
        
        unique_accounts = len(set(t["account_id"] for t in self.transactions))
        
        return {
            "total_transactions": len(self.transactions),
            "unique_accounts": unique_accounts,
            "total_credits": float(total_credits),
            "total_debits": float(total_debits),
            "net_flow": float(total_credits - total_debits),
            "reconciliation_issues": len(self.reconciliation_issues)
        }
