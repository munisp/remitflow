"""
Business logic for wallet-service
"""

from typing import List, Optional
from .models import WalletServiceModel, Status
import uuid

class WalletServiceService:
    def __init__(self):
        self.db = {}  # Replace with actual database
    
    async def create(self, data: dict) -> WalletServiceModel:
        entity_id = str(uuid.uuid4())
        entity = WalletServiceModel(
            id=entity_id,
            **data
        )
        self.db[entity_id] = entity
        return entity
    
    async def get(self, id: str) -> Optional[WalletServiceModel]:
        return self.db.get(id)
    
    async def list(self, skip: int = 0, limit: int = 100) -> List[WalletServiceModel]:
        return list(self.db.values())[skip:skip+limit]
    
    async def update(self, id: str, data: dict) -> WalletServiceModel:
        entity = self.db.get(id)
        if not entity:
            raise ValueError(f"Entity {id} not found")
        for key, value in data.items():
            setattr(entity, key, value)
        return entity
    
    async def delete(self, id: str):
        if id in self.db:
            del self.db[id]
