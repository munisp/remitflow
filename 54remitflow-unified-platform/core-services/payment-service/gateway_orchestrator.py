"""
Gateway Orchestrator - Smart routing and multi-gateway management
"""

import httpx
import logging
from typing import Dict, Optional, List, Tuple
from datetime import datetime, timedelta
from decimal import Decimal
from enum import Enum
import asyncio
from collections import defaultdict

logger = logging.getLogger(__name__)


class GatewayStatus(str, Enum):
    """Gateway status"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    DEGRADED = "degraded"
    MAINTENANCE = "maintenance"


class RoutingStrategy(str, Enum):
    """Routing strategies"""
    COST_OPTIMIZED = "cost_optimized"
    SPEED_OPTIMIZED = "speed_optimized"
    RELIABILITY_OPTIMIZED = "reliability_optimized"
    BALANCED = "balanced"


class PaymentGatewayClient:
    """Base payment gateway client"""
    
    def __init__(self, gateway_name: str, api_key: str, api_secret: Optional[str] = None):
        self.gateway_name = gateway_name
        self.api_key = api_key
        self.api_secret = api_secret
        self.client = httpx.AsyncClient(timeout=30)
        self.status = GatewayStatus.ACTIVE
        
        # Performance metrics
        self.total_transactions = 0
        self.successful_transactions = 0
        self.failed_transactions = 0
        self.total_processing_time = 0.0
        self.last_failure_time: Optional[datetime] = None
        
        logger.info(f"Gateway client initialized: {gateway_name}")
    
    async def process_payment(
        self,
        amount: Decimal,
        currency: str,
        payer_details: Dict,
        payee_details: Dict,
        reference: str,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Process payment - to be implemented by subclasses"""
        raise NotImplementedError
    
    async def verify_payment(self, reference: str) -> Dict:
        """Verify payment status"""
        raise NotImplementedError
    
    async def refund_payment(self, reference: str, amount: Optional[Decimal] = None) -> Dict:
        """Refund payment"""
        raise NotImplementedError
    
    def record_transaction(self, success: bool, processing_time: float):
        """Record transaction metrics"""
        self.total_transactions += 1
        if success:
            self.successful_transactions += 1
        else:
            self.failed_transactions += 1
            self.last_failure_time = datetime.utcnow()
        self.total_processing_time += processing_time
    
    def get_success_rate(self) -> float:
        """Calculate success rate"""
        if self.total_transactions == 0:
            return 100.0
        return (self.successful_transactions / self.total_transactions) * 100
    
    def get_average_processing_time(self) -> float:
        """Calculate average processing time"""
        if self.total_transactions == 0:
            return 0.0
        return self.total_processing_time / self.total_transactions
    
    def get_health_score(self) -> float:
        """Calculate gateway health score (0-100)"""
        if self.status != GatewayStatus.ACTIVE:
            return 0.0
        
        success_rate = self.get_success_rate()
        
        # Penalize recent failures
        recency_penalty = 0.0
        if self.last_failure_time:
            minutes_since_failure = (datetime.utcnow() - self.last_failure_time).total_seconds() / 60
            if minutes_since_failure < 60:
                recency_penalty = (60 - minutes_since_failure) / 60 * 20
        
        health_score = success_rate - recency_penalty
        return max(0.0, min(100.0, health_score))
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class NIBSSGateway(PaymentGatewayClient):
    """NIBSS Instant Payment gateway"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__("NIBSS", api_key, api_secret)
        self.base_url = "https://api.nibss-plc.com.ng"
        self.fee_percentage = Decimal("0.5")  # 0.5%
        self.max_fee = Decimal("100")  # 100 NGN cap
    
    async def process_payment(
        self,
        amount: Decimal,
        currency: str,
        payer_details: Dict,
        payee_details: Dict,
        reference: str,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Process NIBSS payment"""
        
        start_time = datetime.utcnow()
        
        payload = {
            "amount": str(amount),
            "currency": currency,
            "reference": reference,
            "sourceAccount": payer_details.get("account"),
            "destinationAccount": payee_details.get("account"),
            "destinationBankCode": payee_details.get("bank_code"),
            "narration": metadata.get("description", "Payment") if metadata else "Payment"
        }
        
        try:
            # Simulate NIBSS API call
            await asyncio.sleep(0.5)  # Simulate network delay
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            self.record_transaction(True, processing_time)
            
            return {
                "success": True,
                "gateway": self.gateway_name,
                "gateway_reference": f"NIBSS{reference}",
                "status": "completed",
                "message": "Payment processed successfully"
            }
        
        except Exception as e:
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            self.record_transaction(False, processing_time)
            logger.error(f"NIBSS payment error: {e}")
            return {
                "success": False,
                "gateway": self.gateway_name,
                "error": str(e)
            }
    
    async def verify_payment(self, reference: str) -> Dict:
        """Verify NIBSS payment"""
        try:
            return {
                "reference": reference,
                "status": "completed",
                "verified": True
            }
        except Exception as e:
            logger.error(f"NIBSS verify error: {e}")
            return {"reference": reference, "status": "unknown", "error": str(e)}
    
    async def refund_payment(self, reference: str, amount: Optional[Decimal] = None) -> Dict:
        """Refund NIBSS payment"""
        try:
            return {
                "success": True,
                "refund_reference": f"REF{reference}",
                "message": "Refund processed"
            }
        except Exception as e:
            logger.error(f"NIBSS refund error: {e}")
            return {"success": False, "error": str(e)}
    
    def calculate_fee(self, amount: Decimal) -> Decimal:
        """Calculate NIBSS transaction fee"""
        fee = amount * self.fee_percentage / 100
        return min(fee, self.max_fee)


class FlutterwaveGateway(PaymentGatewayClient):
    """Flutterwave payment gateway"""
    
    def __init__(self, api_key: str, api_secret: str):
        super().__init__("Flutterwave", api_key, api_secret)
        self.base_url = "https://api.flutterwave.com/v3"
        self.fee_percentage = Decimal("1.4")  # 1.4%
    
    async def process_payment(
        self,
        amount: Decimal,
        currency: str,
        payer_details: Dict,
        payee_details: Dict,
        reference: str,
        metadata: Optional[Dict] = None
    ) -> Dict:
        """Process Flutterwave payment"""
        
        start_time = datetime.utcnow()
        
        payload = {
            "tx_ref": reference,
            "amount": str(amount),
            "currency": currency,
            "redirect_url": metadata.get("callback_url") if metadata else None,
            "customer": {
                "email": payer_details.get("email"),
                "name": payer_details.get("name"),
                "phonenumber": payer_details.get("phone")
            },
            "customizations": {
                "title": "Payment",
                "description": metadata.get("description") if metadata else "Payment"
            }
        }
        
        try:
            await asyncio.sleep(0.3)  # Simulate network delay
            
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            self.record_transaction(True, processing_time)
            
            return {
                "success": True,
                "gateway": self.gateway_name,
                "gateway_reference": f"FLW{reference}",
                "status": "completed",
                "message": "Payment processed successfully"
            }
        
        except Exception as e:
            processing_time = (datetime.utcnow() - start_time).total_seconds()
            self.record_transaction(False, processing_time)
            logger.error(f"Flutterwave payment error: {e}")
            return {
                "success": False,
                "gateway": self.gateway_name,
                "error": str(e)
            }
    
    async def verify_payment(self, reference: str) -> Dict:
        """Verify Flutterwave payment"""
        try:
            return {
                "reference": reference,
                "status": "completed",
                "verified": True
            }
        except Exception as e:
            logger.error(f"Flutterwave verify error: {e}")
            return {"reference": reference, "status": "unknown", "error": str(e)}
    
    async def refund_payment(self, reference: str, amount: Optional[Decimal] = None) -> Dict:
        """Refund Flutterwave payment"""
        try:
            return {
                "success": True,
                "refund_reference": f"REF{reference}",
                "message": "Refund processed"
            }
        except Exception as e:
            logger.error(f"Flutterwave refund error: {e}")
            return {"success": False, "error": str(e)}
    
    def calculate_fee(self, amount: Decimal) -> Decimal:
        """Calculate Flutterwave transaction fee"""
        return amount * self.fee_percentage / 100


class GatewayOrchestrator:
    """Orchestrates payment routing across multiple gateways"""
    
    def __init__(self):
        self.gateways: Dict[str, PaymentGatewayClient] = {}
        self.routing_strategy = RoutingStrategy.BALANCED
        self.routing_history: List[Dict] = []
        logger.info("Gateway orchestrator initialized")
    
    def add_gateway(self, gateway: PaymentGatewayClient):
        """Add payment gateway"""
        self.gateways[gateway.gateway_name] = gateway
        logger.info(f"Gateway added: {gateway.gateway_name}")
    
    def remove_gateway(self, gateway_name: str):
        """Remove payment gateway"""
        if gateway_name in self.gateways:
            del self.gateways[gateway_name]
            logger.info(f"Gateway removed: {gateway_name}")
    
    def set_routing_strategy(self, strategy: RoutingStrategy):
        """Set routing strategy"""
        self.routing_strategy = strategy
        logger.info(f"Routing strategy set to: {strategy.value}")
    
    def select_gateway(
        self,
        amount: Decimal,
        currency: str,
        payment_method: str
    ) -> Optional[PaymentGatewayClient]:
        """Select best gateway based on routing strategy"""
        
        active_gateways = [
            g for g in self.gateways.values()
            if g.status == GatewayStatus.ACTIVE
        ]
        
        if not active_gateways:
            logger.error("No active gateways available")
            return None
        
        if self.routing_strategy == RoutingStrategy.COST_OPTIMIZED:
            return self._select_cheapest_gateway(active_gateways, amount)
        
        elif self.routing_strategy == RoutingStrategy.SPEED_OPTIMIZED:
            return self._select_fastest_gateway(active_gateways)
        
        elif self.routing_strategy == RoutingStrategy.RELIABILITY_OPTIMIZED:
            return self._select_most_reliable_gateway(active_gateways)
        
        else:  # BALANCED
            return self._select_balanced_gateway(active_gateways, amount)
    
    def _select_cheapest_gateway(
        self,
        gateways: List[PaymentGatewayClient],
        amount: Decimal
    ) -> PaymentGatewayClient:
        """Select gateway with lowest fees"""
        
        gateway_fees = []
        for gateway in gateways:
            if hasattr(gateway, 'calculate_fee'):
                fee = gateway.calculate_fee(amount)
                gateway_fees.append((gateway, fee))
        
        if gateway_fees:
            return min(gateway_fees, key=lambda x: x[1])[0]
        return gateways[0]
    
    def _select_fastest_gateway(
        self,
        gateways: List[PaymentGatewayClient]
    ) -> PaymentGatewayClient:
        """Select gateway with fastest processing time"""
        
        return min(gateways, key=lambda g: g.get_average_processing_time())
    
    def _select_most_reliable_gateway(
        self,
        gateways: List[PaymentGatewayClient]
    ) -> PaymentGatewayClient:
        """Select gateway with highest success rate"""
        
        return max(gateways, key=lambda g: g.get_success_rate())
    
    def _select_balanced_gateway(
        self,
        gateways: List[PaymentGatewayClient],
        amount: Decimal
    ) -> PaymentGatewayClient:
        """Select gateway with best overall score"""
        
        gateway_scores = []
        for gateway in gateways:
            health_score = gateway.get_health_score()
            success_rate = gateway.get_success_rate()
            avg_time = gateway.get_average_processing_time()
            
            # Calculate composite score
            speed_score = max(0, 100 - (avg_time * 10))
            composite_score = (health_score * 0.4) + (success_rate * 0.4) + (speed_score * 0.2)
            
            gateway_scores.append((gateway, composite_score))
        
        return max(gateway_scores, key=lambda x: x[1])[0]
    
    async def process_payment(
        self,
        amount: Decimal,
        currency: str,
        payment_method: str,
        payer_details: Dict,
        payee_details: Dict,
        reference: str,
        metadata: Optional[Dict] = None,
        preferred_gateway: Optional[str] = None
    ) -> Dict:
        """Process payment with automatic gateway selection and failover"""
        
        # Try preferred gateway first
        if preferred_gateway and preferred_gateway in self.gateways:
            gateway = self.gateways[preferred_gateway]
            if gateway.status == GatewayStatus.ACTIVE:
                result = await gateway.process_payment(
                    amount, currency, payer_details, payee_details, reference, metadata
                )
                
                self._record_routing_decision(gateway.gateway_name, result.get("success", False))
                
                if result.get("success"):
                    return result
                
                logger.warning(f"Preferred gateway {preferred_gateway} failed, trying fallback")
        
        # Select gateway using routing strategy
        gateway = self.select_gateway(amount, currency, payment_method)
        
        if not gateway:
            return {
                "success": False,
                "error": "No available gateways"
            }
        
        # Try selected gateway
        result = await gateway.process_payment(
            amount, currency, payer_details, payee_details, reference, metadata
        )
        
        self._record_routing_decision(gateway.gateway_name, result.get("success", False))
        
        if result.get("success"):
            return result
        
        # Failover to other gateways
        logger.warning(f"Gateway {gateway.gateway_name} failed, trying failover")
        
        for fallback_gateway in self.gateways.values():
            if fallback_gateway.gateway_name == gateway.gateway_name:
                continue
            
            if fallback_gateway.status != GatewayStatus.ACTIVE:
                continue
            
            result = await fallback_gateway.process_payment(
                amount, currency, payer_details, payee_details, reference, metadata
            )
            
            self._record_routing_decision(fallback_gateway.gateway_name, result.get("success", False))
            
            if result.get("success"):
                logger.info(f"Failover successful with {fallback_gateway.gateway_name}")
                return result
        
        return {
            "success": False,
            "error": "All gateways failed"
        }
    
    def _record_routing_decision(self, gateway_name: str, success: bool):
        """Record routing decision for analytics"""
        self.routing_history.append({
            "gateway": gateway_name,
            "success": success,
            "timestamp": datetime.utcnow().isoformat(),
            "strategy": self.routing_strategy.value
        })
    
    def get_gateway_statistics(self) -> Dict:
        """Get statistics for all gateways"""
        
        stats = {}
        for name, gateway in self.gateways.items():
            stats[name] = {
                "status": gateway.status.value,
                "total_transactions": gateway.total_transactions,
                "successful_transactions": gateway.successful_transactions,
                "failed_transactions": gateway.failed_transactions,
                "success_rate": round(gateway.get_success_rate(), 2),
                "average_processing_time": round(gateway.get_average_processing_time(), 3),
                "health_score": round(gateway.get_health_score(), 2)
            }
        
        return stats
    
    def get_routing_analytics(self, days: int = 7) -> Dict:
        """Get routing analytics"""
        
        cutoff = datetime.utcnow() - timedelta(days=days)
        
        recent_history = [
            h for h in self.routing_history
            if datetime.fromisoformat(h["timestamp"]) >= cutoff
        ]
        
        gateway_usage = defaultdict(int)
        gateway_success = defaultdict(int)
        
        for record in recent_history:
            gateway_usage[record["gateway"]] += 1
            if record["success"]:
                gateway_success[record["gateway"]] += 1
        
        return {
            "period_days": days,
            "total_routed": len(recent_history),
            "gateway_usage": dict(gateway_usage),
            "gateway_success_count": dict(gateway_success),
            "current_strategy": self.routing_strategy.value
        }
