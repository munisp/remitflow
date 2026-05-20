"""
Bill Payment Providers - Integration with utility providers
"""

import logging
from typing import Dict, List
from decimal import Decimal
from datetime import datetime
import uuid
import asyncio

logger = logging.getLogger(__name__)


class BillProvider:
    """Base bill payment provider"""
    
    def __init__(self, name: str):
        self.name = name
        self.total_payments = 0
        self.successful_payments = 0
        logger.info(f"Provider initialized: {name}")
    
    async def pay_bill(self, account_number: str, amount: Decimal, metadata: Dict) -> Dict:
        """Pay bill - to be implemented by subclasses"""
        raise NotImplementedError
    
    async def verify_account(self, account_number: str) -> Dict:
        """Verify account"""
        raise NotImplementedError


class ElectricityProvider(BillProvider):
    """Electricity bill payment"""
    
    def __init__(self):
        super().__init__("Electricity")
    
    async def pay_bill(self, account_number: str, amount: Decimal, metadata: Dict) -> Dict:
        """Pay electricity bill"""
        await asyncio.sleep(0.2)
        
        self.total_payments += 1
        self.successful_payments += 1
        
        return {
            "success": True,
            "reference": f"ELEC{uuid.uuid4().hex[:10].upper()}",
            "token": f"TOKEN{uuid.uuid4().hex[:16].upper()}",
            "units": float(amount / Decimal("50")),
            "provider": self.name
        }
    
    async def verify_account(self, account_number: str) -> Dict:
        """Verify electricity account"""
        return {
            "valid": True,
            "account_name": "Sample Customer",
            "address": "123 Main St"
        }


class WaterProvider(BillProvider):
    """Water bill payment"""
    
    def __init__(self):
        super().__init__("Water")
    
    async def pay_bill(self, account_number: str, amount: Decimal, metadata: Dict) -> Dict:
        """Pay water bill"""
        await asyncio.sleep(0.2)
        
        self.total_payments += 1
        self.successful_payments += 1
        
        return {
            "success": True,
            "reference": f"WATER{uuid.uuid4().hex[:10].upper()}",
            "receipt_number": f"RCP{uuid.uuid4().hex[:12].upper()}",
            "provider": self.name
        }
    
    async def verify_account(self, account_number: str) -> Dict:
        """Verify water account"""
        return {
            "valid": True,
            "account_name": "Sample Customer",
            "outstanding_balance": 0
        }


class InternetProvider(BillProvider):
    """Internet/ISP bill payment"""
    
    def __init__(self):
        super().__init__("Internet")
    
    async def pay_bill(self, account_number: str, amount: Decimal, metadata: Dict) -> Dict:
        """Pay internet bill"""
        await asyncio.sleep(0.2)
        
        self.total_payments += 1
        self.successful_payments += 1
        
        return {
            "success": True,
            "reference": f"NET{uuid.uuid4().hex[:10].upper()}",
            "subscription_extended": True,
            "provider": self.name
        }
    
    async def verify_account(self, account_number: str) -> Dict:
        """Verify internet account"""
        return {
            "valid": True,
            "account_name": "Sample Customer",
            "current_plan": "Premium"
        }


class BillPaymentManager:
    """Manages bill payment providers"""
    
    def __init__(self):
        self.providers: Dict[str, BillProvider] = {
            "electricity": ElectricityProvider(),
            "water": WaterProvider(),
            "internet": InternetProvider()
        }
        self.payment_history: List[Dict] = []
        logger.info("Bill payment manager initialized")
    
    async def process_payment(
        self,
        bill_type: str,
        account_number: str,
        amount: Decimal,
        metadata: Dict = None
    ) -> Dict:
        """Process bill payment"""
        
        provider = self.providers.get(bill_type.lower())
        if not provider:
            return {"success": False, "error": f"Unknown bill type: {bill_type}"}
        
        try:
            result = await provider.pay_bill(account_number, amount, metadata or {})
            
            # Record payment
            self.payment_history.append({
                "bill_type": bill_type,
                "account_number": account_number,
                "amount": float(amount),
                "result": result,
                "timestamp": datetime.utcnow().isoformat()
            })
            
            return result
        
        except Exception as e:
            logger.error(f"Payment failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def verify_account(self, bill_type: str, account_number: str) -> Dict:
        """Verify account"""
        provider = self.providers.get(bill_type.lower())
        if not provider:
            return {"valid": False, "error": f"Unknown bill type: {bill_type}"}
        
        return await provider.verify_account(account_number)
    
    def get_payment_history(self, limit: int = 50) -> List[Dict]:
        """Get payment history"""
        return self.payment_history[-limit:]
    
    def get_statistics(self) -> Dict:
        """Get payment statistics"""
        return {
            "total_payments": len(self.payment_history),
            "providers": {
                name: {
                    "total": provider.total_payments,
                    "successful": provider.successful_payments
                }
                for name, provider in self.providers.items()
            }
        }
