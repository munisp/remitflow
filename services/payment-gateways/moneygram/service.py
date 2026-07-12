"""
MONEYGRAM Payment Gateway Service
"""

from .client import MoneygramClient
from typing import Dict
import os

class MoneygramService:
    def __init__(self):
        self.client = MoneygramClient(
            api_key=os.getenv("MONEYGRAM_API_KEY", "test_key")
        )
    
    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through moneygram"""
        try:
            result = await self.client.initiate_transfer(transfer_data)
            return {
                "success": True,
                "gateway": "moneygram",
                "transfer_id": result.get("id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "moneygram",
                "error": str(e)
            }
    
    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "moneygram",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "moneygram",
                "error": str(e)
            }
