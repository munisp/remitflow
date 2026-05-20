"""
Retry Manager - Intelligent retry logic for failed payments
"""

import logging
from typing import Dict, Optional, List
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
import asyncio

logger = logging.getLogger(__name__)


class RetryStrategy(str, Enum):
    """Retry strategies"""
    IMMEDIATE = "immediate"
    EXPONENTIAL_BACKOFF = "exponential_backoff"
    FIXED_INTERVAL = "fixed_interval"
    SMART = "smart"


class FailureCategory(str, Enum):
    """Failure categories"""
    NETWORK_ERROR = "network_error"
    GATEWAY_ERROR = "gateway_error"
    INSUFFICIENT_FUNDS = "insufficient_funds"
    INVALID_ACCOUNT = "invalid_account"
    TIMEOUT = "timeout"
    UNKNOWN = "unknown"


class RetryManager:
    """Manages payment retry logic"""
    
    def __init__(self):
        self.max_retries = 3
        self.retry_strategy = RetryStrategy.EXPONENTIAL_BACKOFF
        self.retry_history: List[Dict] = []
        
        # Retry configuration per failure category
        self.retry_config = {
            FailureCategory.NETWORK_ERROR: {"max_retries": 5, "retryable": True},
            FailureCategory.GATEWAY_ERROR: {"max_retries": 3, "retryable": True},
            FailureCategory.INSUFFICIENT_FUNDS: {"max_retries": 0, "retryable": False},
            FailureCategory.INVALID_ACCOUNT: {"max_retries": 0, "retryable": False},
            FailureCategory.TIMEOUT: {"max_retries": 3, "retryable": True},
            FailureCategory.UNKNOWN: {"max_retries": 2, "retryable": True}
        }
        
        logger.info("Retry manager initialized")
    
    def categorize_failure(self, error_message: str, error_code: Optional[str] = None) -> FailureCategory:
        """Categorize payment failure"""
        
        error_lower = error_message.lower()
        
        if "network" in error_lower or "connection" in error_lower:
            return FailureCategory.NETWORK_ERROR
        
        if "timeout" in error_lower or "timed out" in error_lower:
            return FailureCategory.TIMEOUT
        
        if "insufficient" in error_lower or "balance" in error_lower:
            return FailureCategory.INSUFFICIENT_FUNDS
        
        if "invalid account" in error_lower or "account not found" in error_lower:
            return FailureCategory.INVALID_ACCOUNT
        
        if "gateway" in error_lower or "service unavailable" in error_lower:
            return FailureCategory.GATEWAY_ERROR
        
        return FailureCategory.UNKNOWN
    
    def should_retry(
        self,
        failure_category: FailureCategory,
        current_retry_count: int
    ) -> bool:
        """Determine if payment should be retried"""
        
        config = self.retry_config.get(failure_category)
        
        if not config or not config["retryable"]:
            return False
        
        return current_retry_count < config["max_retries"]
    
    def calculate_retry_delay(
        self,
        retry_count: int,
        failure_category: FailureCategory
    ) -> float:
        """Calculate delay before next retry (in seconds)"""
        
        if self.retry_strategy == RetryStrategy.IMMEDIATE:
            return 0.0
        
        elif self.retry_strategy == RetryStrategy.FIXED_INTERVAL:
            return 5.0  # 5 seconds
        
        elif self.retry_strategy == RetryStrategy.EXPONENTIAL_BACKOFF:
            # 2^retry_count seconds (1, 2, 4, 8, 16...)
            base_delay = 2 ** retry_count
            return min(base_delay, 60.0)  # Cap at 60 seconds
        
        else:  # SMART
            # Adjust delay based on failure category
            if failure_category == FailureCategory.NETWORK_ERROR:
                return min(2 ** retry_count, 30.0)
            
            elif failure_category == FailureCategory.TIMEOUT:
                return min(5 * (retry_count + 1), 60.0)
            
            elif failure_category == FailureCategory.GATEWAY_ERROR:
                return min(10 * (retry_count + 1), 120.0)
            
            else:
                return min(2 ** retry_count, 60.0)
    
    async def retry_payment(
        self,
        payment_id: str,
        payment_function,
        payment_args: Dict,
        error_message: str,
        error_code: Optional[str] = None,
        current_retry_count: int = 0
    ) -> Dict:
        """Retry failed payment with intelligent logic"""
        
        # Categorize failure
        failure_category = self.categorize_failure(error_message, error_code)
        
        # Check if should retry
        if not self.should_retry(failure_category, current_retry_count):
            logger.info(f"Payment {payment_id} not retryable: {failure_category.value}")
            return {
                "success": False,
                "retried": False,
                "reason": f"Not retryable: {failure_category.value}",
                "retry_count": current_retry_count
            }
        
        # Calculate delay
        delay = self.calculate_retry_delay(current_retry_count, failure_category)
        
        logger.info(
            f"Retrying payment {payment_id} in {delay}s "
            f"(attempt {current_retry_count + 1}, category: {failure_category.value})"
        )
        
        # Wait before retry
        if delay > 0:
            await asyncio.sleep(delay)
        
        # Record retry attempt
        self.retry_history.append({
            "payment_id": payment_id,
            "retry_count": current_retry_count + 1,
            "failure_category": failure_category.value,
            "delay": delay,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Attempt retry
        try:
            result = await payment_function(**payment_args)
            
            if result.get("success"):
                logger.info(f"Payment {payment_id} succeeded on retry {current_retry_count + 1}")
                return {
                    "success": True,
                    "retried": True,
                    "retry_count": current_retry_count + 1,
                    "result": result
                }
            else:
                # Retry failed, check if should retry again
                new_error = result.get("error", "Unknown error")
                return await self.retry_payment(
                    payment_id,
                    payment_function,
                    payment_args,
                    new_error,
                    result.get("error_code"),
                    current_retry_count + 1
                )
        
        except Exception as e:
            logger.error(f"Retry attempt {current_retry_count + 1} failed: {e}")
            return await self.retry_payment(
                payment_id,
                payment_function,
                payment_args,
                str(e),
                None,
                current_retry_count + 1
            )
    
    def get_retry_statistics(self, days: int = 7) -> Dict:
        """Get retry statistics"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent_retries = [
            r for r in self.retry_history
            if datetime.fromisoformat(r["timestamp"]) >= cutoff
        ]
        
        if not recent_retries:
            return {
                "period_days": days,
                "total_retries": 0
            }
        
        # Count by category
        category_counts = {}
        for retry in recent_retries:
            category = retry["failure_category"]
            category_counts[category] = category_counts.get(category, 0) + 1
        
        # Average delay
        total_delay = sum(r["delay"] for r in recent_retries)
        avg_delay = total_delay / len(recent_retries)
        
        return {
            "period_days": days,
            "total_retries": len(recent_retries),
            "category_breakdown": category_counts,
            "average_delay": round(avg_delay, 2),
            "current_strategy": self.retry_strategy.value
        }
    
    def get_payment_retry_history(self, payment_id: str) -> List[Dict]:
        """Get retry history for specific payment"""
        
        return [
            r for r in self.retry_history
            if r["payment_id"] == payment_id
        ]


class RecoveryManager:
    """Manages payment recovery for stuck/failed payments"""
    
    def __init__(self):
        self.pending_recoveries: Dict[str, Dict] = {}
        self.recovered_payments: List[Dict] = []
        logger.info("Recovery manager initialized")
    
    def mark_for_recovery(
        self,
        payment_id: str,
        payment_details: Dict,
        failure_reason: str
    ):
        """Mark payment for recovery"""
        
        self.pending_recoveries[payment_id] = {
            "payment_id": payment_id,
            "payment_details": payment_details,
            "failure_reason": failure_reason,
            "marked_at": datetime.utcnow().isoformat(),
            "recovery_attempts": 0
        }
        
        logger.info(f"Payment {payment_id} marked for recovery")
    
    async def attempt_recovery(
        self,
        payment_id: str,
        recovery_function
    ) -> Dict:
        """Attempt to recover payment"""
        
        if payment_id not in self.pending_recoveries:
            return {
                "success": False,
                "error": "Payment not found in recovery queue"
            }
        
        recovery_info = self.pending_recoveries[payment_id]
        recovery_info["recovery_attempts"] += 1
        
        logger.info(f"Attempting recovery for payment {payment_id} (attempt {recovery_info['recovery_attempts']})")
        
        try:
            result = await recovery_function(recovery_info["payment_details"])
            
            if result.get("success"):
                # Recovery successful
                self.recovered_payments.append({
                    "payment_id": payment_id,
                    "recovered_at": datetime.utcnow().isoformat(),
                    "attempts": recovery_info["recovery_attempts"]
                })
                
                del self.pending_recoveries[payment_id]
                
                logger.info(f"Payment {payment_id} recovered successfully")
                return {
                    "success": True,
                    "recovered": True,
                    "attempts": recovery_info["recovery_attempts"]
                }
            else:
                return {
                    "success": False,
                    "recovered": False,
                    "attempts": recovery_info["recovery_attempts"],
                    "error": result.get("error")
                }
        
        except Exception as e:
            logger.error(f"Recovery attempt failed: {e}")
            return {
                "success": False,
                "recovered": False,
                "attempts": recovery_info["recovery_attempts"],
                "error": str(e)
            }
    
    def get_pending_recoveries(self) -> List[Dict]:
        """Get list of pending recoveries"""
        return list(self.pending_recoveries.values())
    
    def get_recovery_statistics(self) -> Dict:
        """Get recovery statistics"""
        
        return {
            "pending_recoveries": len(self.pending_recoveries),
            "total_recovered": len(self.recovered_payments),
            "recovery_rate": (
                len(self.recovered_payments) / 
                (len(self.recovered_payments) + len(self.pending_recoveries)) * 100
                if (len(self.recovered_payments) + len(self.pending_recoveries)) > 0
                else 0
            )
        }
