"""
Business logic for transaction-service
"""

from typing import List, Optional
from .models import TransactionServiceModel, Status
import uuid

class TransactionServiceService:
    def __init__(self):
        self.db = {}  # Replace with actual database
    
    async def create(self, data: dict) -> TransactionServiceModel:
        entity_id = str(uuid.uuid4())
        entity = TransactionServiceModel(
            id=entity_id,
            **data
        )
        self.db[entity_id] = entity
        return entity
    
    async def get(self, id: str) -> Optional[TransactionServiceModel]:
        return self.db.get(id)
    
    async def list(self, skip: int = 0, limit: int = 100) -> List[TransactionServiceModel]:
        return list(self.db.values())[skip:skip+limit]
    
    async def list_by_user(self, user_id: str, skip: int = 0, limit: int = 100) -> List[TransactionServiceModel]:
        user_transactions = [t for t in self.db.values() if getattr(t, 'user_id', None) == user_id]
        return user_transactions[skip:skip+limit]
    
    async def update(self, id: str, data: dict) -> TransactionServiceModel:
        entity = self.db.get(id)
        if not entity:
            raise ValueError(f"Entity {id} not found")
        for key, value in data.items():
            setattr(entity, key, value)
        return entity
    
    async def delete(self, id: str):
        if id in self.db:
            del self.db[id]
