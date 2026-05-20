"""
Transaction Reconciliation - Automated reconciliation engine
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict

logger = logging.getLogger(__name__)


class ReconciliationEngine:
    """Reconciles transactions across systems"""
    
    def __init__(self):
        self.internal_transactions: List[Dict] = []
        self.external_transactions: List[Dict] = []
        self.discrepancies: List[Dict] = []
        self.reconciled_count = 0
        logger.info("Reconciliation engine initialized")
    
    def add_internal_transaction(self, transaction: Dict):
        """Add internal transaction"""
        self.internal_transactions.append(transaction)
    
    def add_external_transaction(self, transaction: Dict):
        """Add external transaction"""
        self.external_transactions.append(transaction)
    
    def reconcile(self, date: datetime) -> Dict:
        """Reconcile transactions for a specific date"""
        
        start_of_day = date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_of_day = start_of_day + timedelta(days=1)
        
        # Filter transactions for the day
        internal_day = [
            t for t in self.internal_transactions
            if start_of_day <= datetime.fromisoformat(t.get("created_at", "2000-01-01")) < end_of_day
        ]
        
        external_day = [
            t for t in self.external_transactions
            if start_of_day <= datetime.fromisoformat(t.get("created_at", "2000-01-01")) < end_of_day
        ]
        
        # Match by reference
        internal_refs = {t["reference"]: t for t in internal_day}
        external_refs = {t["reference"]: t for t in external_day}
        
        matched = []
        missing_internal = []
        missing_external = []
        amount_mismatches = []
        
        # Find matches and mismatches
        for ref, int_txn in internal_refs.items():
            if ref in external_refs:
                ext_txn = external_refs[ref]
                int_amount = Decimal(str(int_txn.get("amount", 0)))
                ext_amount = Decimal(str(ext_txn.get("amount", 0)))
                
                if abs(int_amount - ext_amount) < Decimal("0.01"):
                    matched.append(ref)
                    self.reconciled_count += 1
                else:
                    amount_mismatches.append({
                        "reference": ref,
                        "internal_amount": float(int_amount),
                        "external_amount": float(ext_amount),
                        "difference": float(int_amount - ext_amount)
                    })
            else:
                missing_external.append(ref)
        
        # Find transactions in external but not internal
        for ref in external_refs:
            if ref not in internal_refs:
                missing_internal.append(ref)
        
        # Record discrepancies
        if missing_internal or missing_external or amount_mismatches:
            self.discrepancies.append({
                "date": date.date().isoformat(),
                "missing_internal": missing_internal,
                "missing_external": missing_external,
                "amount_mismatches": amount_mismatches,
                "reconciled_at": datetime.utcnow().isoformat()
            })
        
        return {
            "date": date.date().isoformat(),
            "total_internal": len(internal_day),
            "total_external": len(external_day),
            "matched": len(matched),
            "missing_internal": len(missing_internal),
            "missing_external": len(missing_external),
            "amount_mismatches": len(amount_mismatches),
            "reconciliation_rate": (len(matched) / max(len(internal_day), 1)) * 100
        }
    
    def get_discrepancies(self, days: int = 7) -> List[Dict]:
        """Get recent discrepancies"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        return [
            d for d in self.discrepancies
            if datetime.fromisoformat(d["reconciled_at"]) >= cutoff
        ]
    
    def get_statistics(self) -> Dict:
        """Get reconciliation statistics"""
        return {
            "total_internal": len(self.internal_transactions),
            "total_external": len(self.external_transactions),
            "reconciled_count": self.reconciled_count,
            "total_discrepancies": len(self.discrepancies)
        }
