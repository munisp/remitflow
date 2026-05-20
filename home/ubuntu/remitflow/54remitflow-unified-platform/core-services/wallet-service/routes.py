"""
API routes for wallet-service
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .models import WalletServiceModel
from .service import WalletServiceService

router = APIRouter(prefix="/api/v1/wallet-service", tags=["wallet-service"])

@router.post("/", response_model=WalletServiceModel)
async def create(data: dict):
    service = WalletServiceService()
    return await service.create(data)

@router.get("/{id}", response_model=WalletServiceModel)
async def get(id: str):
    service = WalletServiceService()
    return await service.get(id)

@router.get("/", response_model=List[WalletServiceModel])
async def list_all(skip: int = 0, limit: int = 100):
    service = WalletServiceService()
    return await service.list(skip, limit)

@router.put("/{id}", response_model=WalletServiceModel)
async def update(id: str, data: dict):
    service = WalletServiceService()
    return await service.update(id, data)

@router.delete("/{id}")
async def delete(id: str):
    service = WalletServiceService()
    await service.delete(id)
    return {"message": "Deleted successfully"}
