"""
Price Lock Service

Locks FX rates for a specified duration while users complete authorization.
Provides transparent fee breakdown at checkout.

Features:
- Lock FX rate for configurable duration (default 5 minutes)
- Transparent fee breakdown (FX spread, platform fee, network fee)
- Rate expiration handling
- Rate comparison with market rates
"""

from datetime import datetime, timedelta
from typing import Optional, Dict, Any, List
from uuid import uuid4
from decimal import Decimal
from enum import Enum
from dataclasses import dataclass

from common.logging_config import get_logger
from common.metrics import MetricsCollector

logger = get_logger(__name__)
metrics = MetricsCollector("price_lock")


class LockStatus(Enum):
    ACTIVE = "ACTIVE"
    EXPIRED = "EXPIRED"
    USED = "USED"
    CANCELLED = "CANCELLED"


@dataclass
class FeeBreakdown:
    platform_fee: Decimal
    platform_fee_percent: Decimal
    fx_spread: Decimal
    fx_spread_percent: Decimal
    network_fee: Decimal
    total_fee: Decimal
    total_fee_percent: Decimal


@dataclass
class PriceLock:
    lock_id: str
    user_id: str
    source_amount: Decimal
    source_currency: str
    destination_currency: str
    locked_rate: Decimal
    market_rate: Decimal
    receive_amount: Decimal
    fee_breakdown: FeeBreakdown
    corridor: str
    created_at: datetime
    expires_at: datetime
    status: LockStatus
    used_at: Optional[datetime] = None
    transfer_id: Optional[str] = None


class PriceLockService:
    """
    Price lock service for FX rate guarantees.
    
    Allows users to lock in an FX rate while completing KYC or authorization,
    with full transparency on fees.
    """
    
    DEFAULT_LOCK_DURATION_SECONDS = 300
    MAX_LOCK_DURATION_SECONDS = 900
    
    FX_RATES = {
        ("NGN", "USD"): Decimal("0.00065"),
        ("USD", "NGN"): Decimal("1538.46"),
        ("NGN", "GHS"): Decimal("0.0078"),
        ("GHS", "NGN"): Decimal("128.21"),
        ("NGN", "KES"): Decimal("0.084"),
        ("KES", "NGN"): Decimal("11.90"),
        ("USD", "INR"): Decimal("83.50"),
        ("INR", "USD"): Decimal("0.012"),
        ("USD", "BRL"): Decimal("4.95"),
        ("BRL", "USD"): Decimal("0.202"),
        ("USD", "CNY"): Decimal("7.25"),
        ("CNY", "USD"): Decimal("0.138"),
        ("NGN", "CNY"): Decimal("0.0047"),
        ("CNY", "NGN"): Decimal("212.77"),
        ("GBP", "NGN"): Decimal("1950.00"),
        ("NGN", "GBP"): Decimal("0.000513"),
        ("EUR", "NGN"): Decimal("1680.00"),
        ("NGN", "EUR"): Decimal("0.000595"),
        ("USD", "GBP"): Decimal("0.79"),
        ("GBP", "USD"): Decimal("1.27"),
        ("USD", "EUR"): Decimal("0.92"),
        ("EUR", "USD"): Decimal("1.09"),
    }
    
    CORRIDOR_FEES = {
        "MOJALOOP": {"platform_percent": Decimal("0.5"), "network_fee": Decimal("0")},
        "PAPSS": {"platform_percent": Decimal("0.8"), "network_fee": Decimal("0")},
        "UPI": {"platform_percent": Decimal("0.2"), "network_fee": Decimal("0")},
        "PIX": {"platform_percent": Decimal("0.1"), "network_fee": Decimal("0")},
        "CIPS": {"platform_percent": Decimal("0.3"), "network_fee": Decimal("5")},
        "STABLECOIN": {"platform_percent": Decimal("1.0"), "network_fee": Decimal("1")},
        "SWIFT": {"platform_percent": Decimal("2.5"), "network_fee": Decimal("25")},
    }
    
    FX_SPREAD_PERCENT = Decimal("0.3")
    
    def __init__(self):
        self.locks: Dict[str, PriceLock] = {}
        self.user_locks: Dict[str, List[str]] = {}
        
    async def create_lock(
        self,
        user_id: str,
        source_amount: Decimal,
        source_currency: str,
        destination_currency: str,
        corridor: str,
        lock_duration_seconds: int = DEFAULT_LOCK_DURATION_SECONDS
    ) -> PriceLock:
        """
        Create a price lock for a transfer.
        
        Locks the FX rate and calculates transparent fee breakdown.
        """
        lock_id = str(uuid4())
        
        lock_duration_seconds = min(lock_duration_seconds, self.MAX_LOCK_DURATION_SECONDS)
        
        market_rate = await self._get_market_rate(source_currency, destination_currency)
        locked_rate = market_rate * (1 - self.FX_SPREAD_PERCENT / 100)
        
        corridor_fees = self.CORRIDOR_FEES.get(corridor, self.CORRIDOR_FEES["SWIFT"])
        
        platform_fee_percent = corridor_fees["platform_percent"]
        platform_fee = source_amount * (platform_fee_percent / 100)
        
        fx_spread = source_amount * (self.FX_SPREAD_PERCENT / 100)
        
        network_fee = corridor_fees["network_fee"]
        
        total_fee = platform_fee + fx_spread + network_fee
        total_fee_percent = (total_fee / source_amount) * 100 if source_amount > 0 else Decimal("0")
        
        net_amount = source_amount - total_fee
        receive_amount = net_amount * locked_rate
        
        fee_breakdown = FeeBreakdown(
            platform_fee=platform_fee,
            platform_fee_percent=platform_fee_percent,
            fx_spread=fx_spread,
            fx_spread_percent=self.FX_SPREAD_PERCENT,
            network_fee=network_fee,
            total_fee=total_fee,
            total_fee_percent=total_fee_percent
        )
        
        now = datetime.utcnow()
        lock = PriceLock(
            lock_id=lock_id,
            user_id=user_id,
            source_amount=source_amount,
            source_currency=source_currency,
            destination_currency=destination_currency,
            locked_rate=locked_rate,
            market_rate=market_rate,
            receive_amount=receive_amount,
            fee_breakdown=fee_breakdown,
            corridor=corridor,
            created_at=now,
            expires_at=now + timedelta(seconds=lock_duration_seconds),
            status=LockStatus.ACTIVE
        )
        
        self.locks[lock_id] = lock
        
        if user_id not in self.user_locks:
            self.user_locks[user_id] = []
        self.user_locks[user_id].append(lock_id)
        
        metrics.increment("price_locks_created")
        logger.info(f"Created price lock {lock_id} for user {user_id}")
        
        return lock
    
    async def get_lock(self, lock_id: str) -> Optional[PriceLock]:
        """Get a price lock by ID."""
        lock = self.locks.get(lock_id)
        if lock and lock.status == LockStatus.ACTIVE:
            if datetime.utcnow() > lock.expires_at:
                lock.status = LockStatus.EXPIRED
                metrics.increment("price_locks_expired")
        return lock
    
    async def use_lock(self, lock_id: str, transfer_id: str) -> PriceLock:
        """Mark a price lock as used for a transfer."""
        lock = await self.get_lock(lock_id)
        if not lock:
            raise ValueError(f"Lock {lock_id} not found")
        
        if lock.status != LockStatus.ACTIVE:
            raise ValueError(f"Lock {lock_id} is {lock.status.value}")
        
        if datetime.utcnow() > lock.expires_at:
            lock.status = LockStatus.EXPIRED
            raise ValueError(f"Lock {lock_id} has expired")
        
        lock.status = LockStatus.USED
        lock.used_at = datetime.utcnow()
        lock.transfer_id = transfer_id
        
        metrics.increment("price_locks_used")
        return lock
    
    async def cancel_lock(self, lock_id: str) -> PriceLock:
        """Cancel a price lock."""
        lock = self.locks.get(lock_id)
        if not lock:
            raise ValueError(f"Lock {lock_id} not found")
        
        if lock.status == LockStatus.USED:
            raise ValueError(f"Lock {lock_id} has already been used")
        
        lock.status = LockStatus.CANCELLED
        metrics.increment("price_locks_cancelled")
        return lock
    
    async def get_user_locks(self, user_id: str, active_only: bool = True) -> List[PriceLock]:
        """Get all locks for a user."""
        lock_ids = self.user_locks.get(user_id, [])
        locks = []
        
        for lock_id in lock_ids:
            lock = await self.get_lock(lock_id)
            if lock:
                if active_only and lock.status != LockStatus.ACTIVE:
                    continue
                locks.append(lock)
        
        return locks
    
    async def get_quote(
        self,
        source_amount: Decimal,
        source_currency: str,
        destination_currency: str,
        corridor: str
    ) -> Dict[str, Any]:
        """
        Get a quote without locking the rate.
        
        Returns transparent fee breakdown and estimated receive amount.
        """
        market_rate = await self._get_market_rate(source_currency, destination_currency)
        quoted_rate = market_rate * (1 - self.FX_SPREAD_PERCENT / 100)
        
        corridor_fees = self.CORRIDOR_FEES.get(corridor, self.CORRIDOR_FEES["SWIFT"])
        
        platform_fee = source_amount * (corridor_fees["platform_percent"] / 100)
        fx_spread = source_amount * (self.FX_SPREAD_PERCENT / 100)
        network_fee = corridor_fees["network_fee"]
        total_fee = platform_fee + fx_spread + network_fee
        
        net_amount = source_amount - total_fee
        receive_amount = net_amount * quoted_rate
        
        return {
            "source_amount": float(source_amount),
            "source_currency": source_currency,
            "destination_currency": destination_currency,
            "receive_amount": float(receive_amount),
            "exchange_rate": float(quoted_rate),
            "market_rate": float(market_rate),
            "corridor": corridor,
            "fee_breakdown": {
                "platform_fee": float(platform_fee),
                "platform_fee_percent": float(corridor_fees["platform_percent"]),
                "fx_spread": float(fx_spread),
                "fx_spread_percent": float(self.FX_SPREAD_PERCENT),
                "network_fee": float(network_fee),
                "total_fee": float(total_fee),
                "total_fee_percent": float((total_fee / source_amount) * 100) if source_amount > 0 else 0
            },
            "rate_valid_for_seconds": self.DEFAULT_LOCK_DURATION_SECONDS,
            "disclaimer": "Rate is indicative. Lock rate to guarantee this price."
        }
    
    async def compare_rates(
        self,
        source_amount: Decimal,
        source_currency: str,
        destination_currency: str
    ) -> Dict[str, Any]:
        """Compare rates across all corridors."""
        comparisons = []
        
        for corridor, fees in self.CORRIDOR_FEES.items():
            quote = await self.get_quote(
                source_amount=source_amount,
                source_currency=source_currency,
                destination_currency=destination_currency,
                corridor=corridor
            )
            comparisons.append({
                "corridor": corridor,
                "receive_amount": quote["receive_amount"],
                "total_fee": quote["fee_breakdown"]["total_fee"],
                "total_fee_percent": quote["fee_breakdown"]["total_fee_percent"],
                "exchange_rate": quote["exchange_rate"]
            })
        
        comparisons.sort(key=lambda x: x["receive_amount"], reverse=True)
        
        return {
            "source_amount": float(source_amount),
            "source_currency": source_currency,
            "destination_currency": destination_currency,
            "comparisons": comparisons,
            "best_value": comparisons[0]["corridor"] if comparisons else None,
            "savings_vs_worst": float(
                Decimal(str(comparisons[0]["receive_amount"])) - 
                Decimal(str(comparisons[-1]["receive_amount"]))
            ) if len(comparisons) > 1 else 0
        }
    
    async def _get_market_rate(
        self,
        source_currency: str,
        destination_currency: str
    ) -> Decimal:
        """Get market FX rate."""
        if source_currency == destination_currency:
            return Decimal("1.0")
        
        rate = self.FX_RATES.get((source_currency, destination_currency))
        if rate:
            return rate
        
        if source_currency != "USD" and destination_currency != "USD":
            source_to_usd = self.FX_RATES.get((source_currency, "USD"), Decimal("1.0"))
            usd_to_dest = self.FX_RATES.get(("USD", destination_currency), Decimal("1.0"))
            return source_to_usd * usd_to_dest
        
        return Decimal("1.0")
    
    def format_lock_summary(self, lock: PriceLock) -> Dict[str, Any]:
        """Format lock for API response."""
        return {
            "lock_id": lock.lock_id,
            "status": lock.status.value,
            "source_amount": float(lock.source_amount),
            "source_currency": lock.source_currency,
            "destination_currency": lock.destination_currency,
            "receive_amount": float(lock.receive_amount),
            "locked_rate": float(lock.locked_rate),
            "market_rate": float(lock.market_rate),
            "corridor": lock.corridor,
            "fee_breakdown": {
                "platform_fee": float(lock.fee_breakdown.platform_fee),
                "platform_fee_percent": float(lock.fee_breakdown.platform_fee_percent),
                "fx_spread": float(lock.fee_breakdown.fx_spread),
                "fx_spread_percent": float(lock.fee_breakdown.fx_spread_percent),
                "network_fee": float(lock.fee_breakdown.network_fee),
                "total_fee": float(lock.fee_breakdown.total_fee),
                "total_fee_percent": float(lock.fee_breakdown.total_fee_percent)
            },
            "created_at": lock.created_at.isoformat(),
            "expires_at": lock.expires_at.isoformat(),
            "seconds_remaining": max(0, int((lock.expires_at - datetime.utcnow()).total_seconds())),
            "transfer_id": lock.transfer_id
        }


def get_price_lock_service() -> PriceLockService:
    """Factory function to get price lock service instance."""
    return PriceLockService()
