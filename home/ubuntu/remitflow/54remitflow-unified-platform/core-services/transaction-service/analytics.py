"""
Transaction Analytics - Real-time analytics and insights
"""

import logging
from typing import Dict, List
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict

logger = logging.getLogger(__name__)


class TransactionAnalytics:
    """Analytics engine for transactions"""
    
    def __init__(self):
        self.transactions: List[Dict] = []
        logger.info("Transaction analytics initialized")
    
    def record_transaction(self, transaction: Dict):
        """Record transaction for analytics"""
        self.transactions.append(transaction)
    
    def get_volume_by_period(self, days: int = 30) -> Dict:
        """Get transaction volume by period"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent = [
            t for t in self.transactions
            if datetime.fromisoformat(t.get("created_at", "2000-01-01")) >= cutoff
        ]
        
        daily_volume = defaultdict(lambda: {"count": 0, "amount": Decimal("0")})
        
        for txn in recent:
            date = datetime.fromisoformat(txn["created_at"]).date()
            daily_volume[date]["count"] += 1
            daily_volume[date]["amount"] += Decimal(str(txn.get("amount", 0)))
        
        return {
            "period_days": days,
            "daily_volume": {
                str(date): {"count": data["count"], "amount": float(data["amount"])}
                for date, data in sorted(daily_volume.items())
            }
        }
    
    def get_statistics(self, days: int = 30) -> Dict:
        """Get transaction statistics"""
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent = [
            t for t in self.transactions
            if datetime.fromisoformat(t.get("created_at", "2000-01-01")) >= cutoff
        ]
        
        if not recent:
            return {"period_days": days, "total_transactions": 0}
        
        total_amount = sum(Decimal(str(t.get("amount", 0))) for t in recent)
        
        by_type = defaultdict(int)
        by_status = defaultdict(int)
        
        for txn in recent:
            by_type[txn.get("type", "unknown")] += 1
            by_status[txn.get("status", "unknown")] += 1
        
        return {
            "period_days": days,
            "total_transactions": len(recent),
            "total_amount": float(total_amount),
            "average_amount": float(total_amount / len(recent)),
            "by_type": dict(by_type),
            "by_status": dict(by_status)
        }
