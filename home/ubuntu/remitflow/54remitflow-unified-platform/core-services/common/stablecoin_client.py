"""
Stablecoin Service Client - For integration with other services.
"""

import os
import logging
from decimal import Decimal
from typing import Optional, List, Dict, Any
from enum import Enum

import httpx

logger = logging.getLogger(__name__)

STABLECOIN_SERVICE_URL = os.getenv("STABLECOIN_SERVICE_URL", "http://localhost:8026")


class Chain(str, Enum):
    ETHEREUM = "ethereum"
    TRON = "tron"
    SOLANA = "solana"
    POLYGON = "polygon"
    BSC = "bsc"


class Stablecoin(str, Enum):
    USDT = "usdt"
    USDC = "usdc"
    PYUSD = "pyusd"
    EURC = "eurc"
    DAI = "dai"


class StablecoinClient:
    """Client for interacting with the Stablecoin Service."""
    
    def __init__(self, base_url: str = STABLECOIN_SERVICE_URL):
        self.base_url = base_url
        self.timeout = 30.0
    
    async def health_check(self) -> Dict[str, Any]:
        """Check stablecoin service health."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/health",
                    timeout=self.timeout
                )
                return response.json()
        except Exception as e:
            logger.error(f"Stablecoin service health check failed: {e}")
            return {"status": "unhealthy", "error": str(e)}
    
    async def create_wallet(
        self,
        user_id: str,
        chains: List[Chain] = None
    ) -> Dict[str, Any]:
        """Create stablecoin wallets for a user."""
        if chains is None:
            chains = [Chain.TRON, Chain.ETHEREUM]
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/wallet/create",
                    json={
                        "user_id": user_id,
                        "chains": [c.value for c in chains],
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to create wallet: {e}")
            raise
    
    async def get_wallets(self, user_id: str) -> Dict[str, Any]:
        """Get all wallets for a user."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/wallet/{user_id}",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get wallets: {e}")
            raise
    
    async def get_balances(self, user_id: str) -> Dict[str, Any]:
        """Get all stablecoin balances for a user."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/wallet/{user_id}/balances",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get balances: {e}")
            raise
    
    async def get_deposit_address(
        self,
        user_id: str,
        chain: Chain
    ) -> Dict[str, Any]:
        """Get deposit address for a specific chain."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/wallet/{user_id}/address/{chain.value}",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get deposit address: {e}")
            raise
    
    async def send_stablecoin(
        self,
        user_id: str,
        chain: Chain,
        stablecoin: Stablecoin,
        amount: Decimal,
        to_address: str,
        is_offline_queued: bool = False
    ) -> Dict[str, Any]:
        """Send stablecoin to an address."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/send",
                    json={
                        "user_id": user_id,
                        "chain": chain.value,
                        "stablecoin": stablecoin.value,
                        "amount": str(amount),
                        "to_address": to_address,
                        "is_offline_queued": is_offline_queued,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to send stablecoin: {e}")
            raise
    
    async def get_quote(
        self,
        from_currency: str,
        to_currency: str,
        amount: Decimal,
        use_ml_optimization: bool = True
    ) -> Dict[str, Any]:
        """Get conversion quote."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/quote",
                    json={
                        "from_currency": from_currency,
                        "to_currency": to_currency,
                        "amount": str(amount),
                        "use_ml_optimization": use_ml_optimization,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get quote: {e}")
            raise
    
    async def convert(
        self,
        user_id: str,
        from_stablecoin: Stablecoin,
        from_chain: Chain,
        to_stablecoin: Stablecoin,
        to_chain: Chain,
        amount: Decimal,
        use_ml_optimization: bool = True
    ) -> Dict[str, Any]:
        """Convert between stablecoins or chains."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/convert",
                    json={
                        "user_id": user_id,
                        "from_stablecoin": from_stablecoin.value,
                        "from_chain": from_chain.value,
                        "to_stablecoin": to_stablecoin.value,
                        "to_chain": to_chain.value,
                        "amount": str(amount),
                        "use_ml_optimization": use_ml_optimization,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to convert: {e}")
            raise
    
    async def create_on_ramp(
        self,
        user_id: str,
        fiat_currency: str,
        fiat_amount: Decimal,
        target_stablecoin: Stablecoin,
        target_chain: Chain,
        payment_method: str
    ) -> Dict[str, Any]:
        """Create fiat to stablecoin on-ramp order."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/ramp/on",
                    json={
                        "user_id": user_id,
                        "fiat_currency": fiat_currency,
                        "fiat_amount": str(fiat_amount),
                        "target_stablecoin": target_stablecoin.value,
                        "target_chain": target_chain.value,
                        "payment_method": payment_method,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to create on-ramp: {e}")
            raise
    
    async def create_off_ramp(
        self,
        user_id: str,
        stablecoin: Stablecoin,
        chain: Chain,
        amount: Decimal,
        target_fiat: str,
        payout_method: str,
        payout_details: Dict[str, str]
    ) -> Dict[str, Any]:
        """Create stablecoin to fiat off-ramp order."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/ramp/off",
                    json={
                        "user_id": user_id,
                        "stablecoin": stablecoin.value,
                        "chain": chain.value,
                        "amount": str(amount),
                        "target_fiat": target_fiat,
                        "payout_method": payout_method,
                        "payout_details": payout_details,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to create off-ramp: {e}")
            raise
    
    async def get_ramp_rates(self) -> Dict[str, Any]:
        """Get current on/off ramp rates."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/ramp/rates",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get ramp rates: {e}")
            raise
    
    async def get_transactions(
        self,
        user_id: str,
        limit: int = 50
    ) -> Dict[str, Any]:
        """Get all transactions for a user."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/transactions/{user_id}",
                    params={"limit": limit},
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get transactions: {e}")
            raise
    
    async def get_offline_queue(self, user_id: str) -> Dict[str, Any]:
        """Get queued offline transactions."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/offline/queue/{user_id}",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get offline queue: {e}")
            raise
    
    async def process_offline_queue(self, user_id: str) -> Dict[str, Any]:
        """Process all queued offline transactions."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{self.base_url}/offline/process/{user_id}",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to process offline queue: {e}")
            raise
    
    async def get_supported_chains(self) -> Dict[str, Any]:
        """Get all supported chains."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/chains",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get supported chains: {e}")
            raise
    
    async def get_supported_stablecoins(self) -> Dict[str, Any]:
        """Get all supported stablecoins."""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    f"{self.base_url}/stablecoins",
                    timeout=self.timeout
                )
                response.raise_for_status()
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get supported stablecoins: {e}")
            raise


# Global client instance
_stablecoin_client: Optional[StablecoinClient] = None


def get_stablecoin_client() -> StablecoinClient:
    """Get or create stablecoin client instance."""
    global _stablecoin_client
    if _stablecoin_client is None:
        _stablecoin_client = StablecoinClient()
    return _stablecoin_client
