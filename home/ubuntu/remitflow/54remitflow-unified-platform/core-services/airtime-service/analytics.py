"""
Airtime Analytics - Transaction history, patterns, and insights
"""

import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from decimal import Decimal
from collections import defaultdict

logger = logging.getLogger(__name__)


class TransactionAnalytics:
    """Analytics for airtime transactions"""
    
    def __init__(self):
        self.transactions: List[Dict] = []
        logger.info("Transaction analytics initialized")
    
    def record_transaction(self, transaction: Dict):
        """Record transaction for analytics"""
        self.transactions.append({
            **transaction,
            "recorded_at": datetime.utcnow()
        })
    
    def get_user_statistics(
        self,
        user_id: str,
        days: int = 30
    ) -> Dict:
        """Get user transaction statistics"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        user_txns = [
            t for t in self.transactions
            if t.get("user_id") == user_id and
            t.get("created_at", datetime.min) >= cutoff
        ]
        
        if not user_txns:
            return {
                "user_id": user_id,
                "period_days": days,
                "total_transactions": 0,
                "total_spent": 0.0
            }
        
        total_spent = sum(
            float(t.get("total_amount", 0))
            for t in user_txns
        )
        
        successful = [t for t in user_txns if t.get("status") == "completed"]
        failed = [t for t in user_txns if t.get("status") == "failed"]
        
        # Network breakdown
        network_breakdown = defaultdict(int)
        for t in successful:
            network = t.get("network", "unknown")
            network_breakdown[network] += 1
        
        # Product type breakdown
        product_breakdown = defaultdict(int)
        for t in successful:
            product_type = t.get("product_type", "unknown")
            product_breakdown[product_type] += 1
        
        # Average transaction
        avg_amount = total_spent / len(user_txns) if user_txns else 0
        
        return {
            "user_id": user_id,
            "period_days": days,
            "total_transactions": len(user_txns),
            "successful_transactions": len(successful),
            "failed_transactions": len(failed),
            "success_rate": (len(successful) / len(user_txns) * 100) if user_txns else 0,
            "total_spent": round(total_spent, 2),
            "average_transaction": round(avg_amount, 2),
            "network_breakdown": dict(network_breakdown),
            "product_breakdown": dict(product_breakdown)
        }
    
    def get_network_statistics(
        self,
        network: str,
        days: int = 30
    ) -> Dict:
        """Get network-specific statistics"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        network_txns = [
            t for t in self.transactions
            if t.get("network") == network and
            t.get("created_at", datetime.min) >= cutoff
        ]
        
        if not network_txns:
            return {
                "network": network,
                "period_days": days,
                "total_transactions": 0
            }
        
        successful = [t for t in network_txns if t.get("status") == "completed"]
        
        total_volume = sum(
            float(t.get("amount", 0))
            for t in successful
        )
        
        total_revenue = sum(
            float(t.get("fee", 0))
            for t in successful
        )
        
        return {
            "network": network,
            "period_days": days,
            "total_transactions": len(network_txns),
            "successful_transactions": len(successful),
            "success_rate": (len(successful) / len(network_txns) * 100) if network_txns else 0,
            "total_volume": round(total_volume, 2),
            "total_revenue": round(total_revenue, 2)
        }
    
    def get_popular_bundles(
        self,
        network: Optional[str] = None,
        limit: int = 10
    ) -> List[Dict]:
        """Get most popular data bundles"""
        
        data_txns = [
            t for t in self.transactions
            if t.get("product_type") == "data" and
            t.get("status") == "completed"
        ]
        
        if network:
            data_txns = [t for t in data_txns if t.get("network") == network]
        
        bundle_counts = defaultdict(int)
        bundle_info = {}
        
        for t in data_txns:
            bundle_id = t.get("bundle_id")
            if bundle_id:
                bundle_counts[bundle_id] += 1
                if bundle_id not in bundle_info:
                    bundle_info[bundle_id] = {
                        "bundle_id": bundle_id,
                        "bundle_name": t.get("bundle_name", "Unknown"),
                        "network": t.get("network"),
                        "price": float(t.get("price", 0))
                    }
        
        popular = []
        for bundle_id, count in sorted(bundle_counts.items(), key=lambda x: x[1], reverse=True)[:limit]:
            info = bundle_info[bundle_id]
            info["purchase_count"] = count
            popular.append(info)
        
        return popular
    
    def get_hourly_distribution(self, days: int = 7) -> Dict:
        """Get hourly transaction distribution"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent_txns = [
            t for t in self.transactions
            if t.get("created_at", datetime.min) >= cutoff
        ]
        
        hourly_counts = defaultdict(int)
        for t in recent_txns:
            created_at = t.get("created_at")
            if created_at:
                hour = created_at.hour
                hourly_counts[hour] += 1
        
        return {
            "period_days": days,
            "hourly_distribution": {
                f"{hour:02d}:00": count
                for hour, count in sorted(hourly_counts.items())
            }
        }
    
    def get_failure_analysis(self, days: int = 7) -> Dict:
        """Analyze failed transactions"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        failed_txns = [
            t for t in self.transactions
            if t.get("status") == "failed" and
            t.get("created_at", datetime.min) >= cutoff
        ]
        
        if not failed_txns:
            return {
                "period_days": days,
                "total_failures": 0
            }
        
        # Failure reasons
        reasons = defaultdict(int)
        for t in failed_txns:
            error = t.get("error_message", "Unknown error")
            reasons[error] += 1
        
        # Network breakdown
        network_failures = defaultdict(int)
        for t in failed_txns:
            network = t.get("network", "unknown")
            network_failures[network] += 1
        
        return {
            "period_days": days,
            "total_failures": len(failed_txns),
            "failure_reasons": dict(reasons),
            "network_breakdown": dict(network_failures)
        }
    
    def get_revenue_report(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> Dict:
        """Generate revenue report"""
        
        period_txns = [
            t for t in self.transactions
            if start_date <= t.get("created_at", datetime.min) <= end_date and
            t.get("status") == "completed"
        ]
        
        if not period_txns:
            return {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "total_revenue": 0.0
            }
        
        total_revenue = sum(
            float(t.get("fee", 0))
            for t in period_txns
        )
        
        total_volume = sum(
            float(t.get("amount", 0))
            for t in period_txns
        )
        
        # Daily breakdown
        daily_revenue = defaultdict(float)
        for t in period_txns:
            date = t.get("created_at").date()
            daily_revenue[date] += float(t.get("fee", 0))
        
        return {
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "total_transactions": len(period_txns),
            "total_volume": round(total_volume, 2),
            "total_revenue": round(total_revenue, 2),
            "average_revenue_per_transaction": round(total_revenue / len(period_txns), 2),
            "daily_revenue": {
                str(date): round(revenue, 2)
                for date, revenue in sorted(daily_revenue.items())
            }
        }
    
    def get_top_users(
        self,
        days: int = 30,
        limit: int = 10
    ) -> List[Dict]:
        """Get top users by transaction volume"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent_txns = [
            t for t in self.transactions
            if t.get("created_at", datetime.min) >= cutoff and
            t.get("status") == "completed"
        ]
        
        user_spending = defaultdict(float)
        user_count = defaultdict(int)
        
        for t in recent_txns:
            user_id = t.get("user_id")
            if user_id:
                user_spending[user_id] += float(t.get("total_amount", 0))
                user_count[user_id] += 1
        
        top_users = []
        for user_id, total_spent in sorted(user_spending.items(), key=lambda x: x[1], reverse=True)[:limit]:
            top_users.append({
                "user_id": user_id,
                "total_spent": round(total_spent, 2),
                "transaction_count": user_count[user_id]
            })
        
        return top_users
    
    def get_overall_statistics(self) -> Dict:
        """Get overall platform statistics"""
        
        if not self.transactions:
            return {"total_transactions": 0}
        
        successful = [t for t in self.transactions if t.get("status") == "completed"]
        failed = [t for t in self.transactions if t.get("status") == "failed"]
        
        total_volume = sum(
            float(t.get("amount", 0))
            for t in successful
        )
        
        total_revenue = sum(
            float(t.get("fee", 0))
            for t in successful
        )
        
        unique_users = len(set(t.get("user_id") for t in self.transactions if t.get("user_id")))
        
        return {
            "total_transactions": len(self.transactions),
            "successful_transactions": len(successful),
            "failed_transactions": len(failed),
            "success_rate": (len(successful) / len(self.transactions) * 100) if self.transactions else 0,
            "total_volume": round(total_volume, 2),
            "total_revenue": round(total_revenue, 2),
            "unique_users": unique_users
        }
