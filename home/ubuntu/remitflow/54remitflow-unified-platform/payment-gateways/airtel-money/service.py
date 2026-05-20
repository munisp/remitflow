"""
AIRTEL-MONEY Payment Gateway Service
"""

from .client import AirtelMoneyClient
from typing import Dict
import os

class AirtelMoneyService:
    def __init__(self):
        self.client = AirtelMoneyClient(
            api_key=os.getenv("AIRTEL-MONEY_API_KEY", "test_key")
        )
    
    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through airtel-money"""
        try:
            result = await self.client.initiate_transfer(transfer_data)
            return {
                "success": True,
                "gateway": "airtel-money",
                "transfer_id": result.get("id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "airtel-money",
                "error": str(e)
            }
    
    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "airtel-money",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "airtel-money",
                "error": str(e)
            }
