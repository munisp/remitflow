"""
API routes for card-service
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .models import CardServiceModel
from .service import CardServiceService

router = APIRouter(prefix="/api/v1/card-service", tags=["card-service"])

@router.post("/", response_model=CardServiceModel)
async def create(data: dict):
    service = CardServiceService()
    return await service.create(data)

@router.get("/{id}", response_model=CardServiceModel)
async def get(id: str):
    service = CardServiceService()
    return await service.get(id)

@router.get("/", response_model=List[CardServiceModel])
async def list_all(skip: int = 0, limit: int = 100):
    service = CardServiceService()
    return await service.list(skip, limit)

@router.put("/{id}", response_model=CardServiceModel)
async def update(id: str, data: dict):
    service = CardServiceService()
    return await service.update(id, data)

@router.delete("/{id}")
async def delete(id: str):
    service = CardServiceService()
    await service.delete(id)
    return {"message": "Deleted successfully"}
