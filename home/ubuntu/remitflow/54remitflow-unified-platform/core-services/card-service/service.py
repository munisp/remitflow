"""
Business logic for card-service
"""

from typing import List, Optional
from .models import CardServiceModel, Status
import uuid

class CardServiceService:
    def __init__(self):
        self.db = {}  # Replace with actual database
    
    async def create(self, data: dict) -> CardServiceModel:
        entity_id = str(uuid.uuid4())
        entity = CardServiceModel(
            id=entity_id,
            **data
        )
        self.db[entity_id] = entity
        return entity
    
    async def get(self, id: str) -> Optional[CardServiceModel]:
        return self.db.get(id)
    
    async def list(self, skip: int = 0, limit: int = 100) -> List[CardServiceModel]:
        return list(self.db.values())[skip:skip+limit]
    
    async def update(self, id: str, data: dict) -> CardServiceModel:
        entity = self.db.get(id)
        if not entity:
            raise ValueError(f"Entity {id} not found")
        for key, value in data.items():
            setattr(entity, key, value)
        return entity
    
    async def delete(self, id: str):
        if id in self.db:
            del self.db[id]
