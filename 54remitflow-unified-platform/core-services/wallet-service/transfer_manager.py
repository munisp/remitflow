"""
Transfer Manager - Instant wallet-to-wallet transfers
"""

import logging
from typing import Dict, List
from decimal import Decimal
from datetime import datetime
import uuid

logger = logging.getLogger(__name__)


class TransferManager:
    """Manages wallet transfers"""
    
    def __init__(self):
        self.transfers: List[Dict] = []
        logger.info("Transfer manager initialized")
    
    async def execute_transfer(
        self,
        from_wallet_id: str,
        to_wallet_id: str,
        amount: Decimal,
        currency: str,
        description: str = ""
    ) -> Dict:
        """Execute instant transfer"""
        
        transfer_id = str(uuid.uuid4())
        reference = f"TRF{uuid.uuid4().hex[:12].upper()}"
        
        transfer = {
            "transfer_id": transfer_id,
            "reference": reference,
            "from_wallet_id": from_wallet_id,
            "to_wallet_id": to_wallet_id,
            "amount": float(amount),
            "currency": currency,
            "description": description,
            "status": "completed",
            "created_at": datetime.utcnow().isoformat()
        }
        
        self.transfers.append(transfer)
        logger.info(f"Transfer executed: {transfer_id}")
        
        return transfer
    
    def get_transfer_history(self, wallet_id: str, limit: int = 50) -> List[Dict]:
        """Get transfer history for wallet"""
        
        wallet_transfers = [
            t for t in self.transfers
            if t["from_wallet_id"] == wallet_id or t["to_wallet_id"] == wallet_id
        ]
        
        return sorted(wallet_transfers, key=lambda x: x["created_at"], reverse=True)[:limit]
