"""
Paystack Refunds and Split Payments
"""

import httpx
import logging
from typing import Dict, Optional, List
from datetime import datetime

logger = logging.getLogger(__name__)


class PaystackRefunds:
    """Handles refund operations"""
    
    def __init__(self, secret_key: str, base_url: str = "https://api.paystack.co"):
        self.secret_key = secret_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        logger.info("Paystack refunds initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    async def create_refund(
        self,
        transaction: str,  # transaction reference or ID
        amount: Optional[int] = None,  # in kobo, None for full refund
        currency: Optional[str] = None,
        customer_note: Optional[str] = None,
        merchant_note: Optional[str] = None
    ) -> Dict:
        """Create a refund"""
        
        payload = {
            "transaction": transaction
        }
        
        if amount:
            payload["amount"] = amount
        
        if currency:
            payload["currency"] = currency
        
        if customer_note:
            payload["customer_note"] = customer_note
        
        if merchant_note:
            payload["merchant_note"] = merchant_note
        
        try:
            response = await self.client.post(
                f"{self.base_url}/refund",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Refund creation failed"))
            
            refund = data["data"]
            
            result = {
                "refund_id": refund["id"],
                "transaction": refund["transaction"],
                "amount": refund["amount"] / 100,
                "currency": refund["currency"],
                "status": refund["status"],
                "created_at": refund["createdAt"]
            }
            
            logger.info(f"Refund created: {result['refund_id']} for {transaction}")
            return result
            
        except Exception as e:
            logger.error(f"Refund creation error: {e}")
            raise
    
    async def list_refunds(
        self,
        reference: Optional[str] = None,
        currency: Optional[str] = None,
        page: int = 1,
        per_page: int = 50
    ) -> Dict:
        """List refunds"""
        
        params = {
            "page": page,
            "perPage": per_page
        }
        
        if reference:
            params["reference"] = reference
        
        if currency:
            params["currency"] = currency
        
        try:
            response = await self.client.get(
                f"{self.base_url}/refund",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Refund list failed"))
            
            refunds = []
            for refund in data["data"]:
                refunds.append({
                    "refund_id": refund["id"],
                    "transaction": refund["transaction"],
                    "amount": refund["amount"] / 100,
                    "currency": refund["currency"],
                    "status": refund["status"],
                    "created_at": refund["createdAt"]
                })
            
            result = {
                "refunds": refunds,
                "total": data["meta"]["total"],
                "page": data["meta"]["page"],
                "per_page": data["meta"]["perPage"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Refund list error: {e}")
            raise
    
    async def get_refund(self, refund_id: str) -> Dict:
        """Get refund details"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/refund/{refund_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Refund fetch failed"))
            
            refund = data["data"]
            
            result = {
                "refund_id": refund["id"],
                "transaction": refund["transaction"],
                "amount": refund["amount"] / 100,
                "currency": refund["currency"],
                "status": refund["status"],
                "customer_note": refund.get("customer_note"),
                "merchant_note": refund.get("merchant_note"),
                "created_at": refund["createdAt"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Refund fetch error: {e}")
            raise
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()


class PaystackSplitPayments:
    """Handles split payment operations"""
    
    def __init__(self, secret_key: str, base_url: str = "https://api.paystack.co"):
        self.secret_key = secret_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=30)
        logger.info("Paystack split payments initialized")
    
    def _get_headers(self) -> Dict[str, str]:
        """Get API headers"""
        return {
            "Authorization": f"Bearer {self.secret_key}",
            "Content-Type": "application/json"
        }
    
    async def create_split(
        self,
        name: str,
        split_type: str,  # "percentage" or "flat"
        currency: str,
        subaccounts: List[Dict],  # [{"subaccount": "ACCT_xxx", "share": 20}]
        bearer_type: str = "account",  # "account", "subaccount", "all-proportional", "all"
        bearer_subaccount: Optional[str] = None
    ) -> Dict:
        """Create a split payment configuration"""
        
        payload = {
            "name": name,
            "type": split_type,
            "currency": currency,
            "subaccounts": subaccounts,
            "bearer_type": bearer_type
        }
        
        if bearer_subaccount:
            payload["bearer_subaccount"] = bearer_subaccount
        
        try:
            response = await self.client.post(
                f"{self.base_url}/split",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Split creation failed"))
            
            split = data["data"]
            
            result = {
                "split_id": split["id"],
                "split_code": split["split_code"],
                "name": split["name"],
                "type": split["type"],
                "currency": split["currency"],
                "active": split["active"]
            }
            
            logger.info(f"Split created: {result['split_code']}")
            return result
            
        except Exception as e:
            logger.error(f"Split creation error: {e}")
            raise
    
    async def list_splits(
        self,
        name: Optional[str] = None,
        active: Optional[bool] = None,
        page: int = 1,
        per_page: int = 50
    ) -> Dict:
        """List split configurations"""
        
        params = {
            "page": page,
            "perPage": per_page
        }
        
        if name:
            params["name"] = name
        
        if active is not None:
            params["active"] = active
        
        try:
            response = await self.client.get(
                f"{self.base_url}/split",
                params=params,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Split list failed"))
            
            splits = []
            for split in data["data"]:
                splits.append({
                    "split_id": split["id"],
                    "split_code": split["split_code"],
                    "name": split["name"],
                    "type": split["type"],
                    "currency": split["currency"],
                    "active": split["active"]
                })
            
            result = {
                "splits": splits,
                "total": data["meta"]["total"],
                "page": data["meta"]["page"],
                "per_page": data["meta"]["perPage"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Split list error: {e}")
            raise
    
    async def get_split(self, split_id: str) -> Dict:
        """Get split configuration details"""
        
        try:
            response = await self.client.get(
                f"{self.base_url}/split/{split_id}",
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Split fetch failed"))
            
            split = data["data"]
            
            result = {
                "split_id": split["id"],
                "split_code": split["split_code"],
                "name": split["name"],
                "type": split["type"],
                "currency": split["currency"],
                "subaccounts": split["subaccounts"],
                "bearer_type": split["bearer_type"],
                "active": split["active"]
            }
            
            return result
            
        except Exception as e:
            logger.error(f"Split fetch error: {e}")
            raise
    
    async def update_split(
        self,
        split_id: str,
        name: Optional[str] = None,
        active: Optional[bool] = None,
        bearer_type: Optional[str] = None,
        bearer_subaccount: Optional[str] = None
    ) -> Dict:
        """Update split configuration"""
        
        payload = {}
        
        if name:
            payload["name"] = name
        
        if active is not None:
            payload["active"] = active
        
        if bearer_type:
            payload["bearer_type"] = bearer_type
        
        if bearer_subaccount:
            payload["bearer_subaccount"] = bearer_subaccount
        
        try:
            response = await self.client.put(
                f"{self.base_url}/split/{split_id}",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Split update failed"))
            
            logger.info(f"Split updated: {split_id}")
            return {"status": "updated", "split_id": split_id}
            
        except Exception as e:
            logger.error(f"Split update error: {e}")
            raise
    
    async def add_subaccount_to_split(
        self,
        split_id: str,
        subaccount: str,
        share: int  # percentage or flat amount
    ) -> Dict:
        """Add subaccount to split"""
        
        payload = {
            "subaccount": subaccount,
            "share": share
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/split/{split_id}/subaccount/add",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Subaccount add failed"))
            
            logger.info(f"Subaccount added to split: {split_id}")
            return {"status": "added", "split_id": split_id, "subaccount": subaccount}
            
        except Exception as e:
            logger.error(f"Subaccount add error: {e}")
            raise
    
    async def remove_subaccount_from_split(
        self,
        split_id: str,
        subaccount: str
    ) -> Dict:
        """Remove subaccount from split"""
        
        payload = {
            "subaccount": subaccount
        }
        
        try:
            response = await self.client.post(
                f"{self.base_url}/split/{split_id}/subaccount/remove",
                json=payload,
                headers=self._get_headers()
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get("status"):
                raise Exception(data.get("message", "Subaccount remove failed"))
            
            logger.info(f"Subaccount removed from split: {split_id}")
            return {"status": "removed", "split_id": split_id, "subaccount": subaccount}
            
        except Exception as e:
            logger.error(f"Subaccount remove error: {e}")
            raise
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()
