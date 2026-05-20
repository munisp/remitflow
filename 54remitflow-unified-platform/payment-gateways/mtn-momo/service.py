"""
MTN-MOMO Payment Gateway Service
"""

from .client import MtnMomoClient
from typing import Dict
import os

class MtnMomoService:
    def __init__(self):
        self.client = MtnMomoClient(
            api_key=os.getenv("MTN-MOMO_API_KEY", "test_key")
        )
    
    async def process_transfer(self, transfer_data: Dict) -> Dict:
        """Process a transfer through mtn-momo"""
        try:
            result = await self.client.initiate_transfer(transfer_data)
            return {
                "success": True,
                "gateway": "mtn-momo",
                "transfer_id": result.get("id"),
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "mtn-momo",
                "error": str(e)
            }
    
    async def check_status(self, transfer_id: str) -> Dict:
        """Check transfer status"""
        try:
            result = await self.client.get_transfer_status(transfer_id)
            return {
                "success": True,
                "gateway": "mtn-momo",
                "status": result.get("status"),
                "data": result
            }
        except Exception as e:
            return {
                "success": False,
                "gateway": "mtn-momo",
                "error": str(e)
            }
