"""
API routes for exchange-rate
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .models import ExchangeRateModel
from .service import ExchangeRateService

router = APIRouter(prefix="/api/v1/exchange-rate", tags=["exchange-rate"])

@router.post("/", response_model=ExchangeRateModel)
async def create(data: dict):
    service = ExchangeRateService()
    return await service.create(data)

@router.get("/{id}", response_model=ExchangeRateModel)
async def get(id: str):
    service = ExchangeRateService()
    return await service.get(id)

@router.get("/", response_model=List[ExchangeRateModel])
async def list_all(skip: int = 0, limit: int = 100):
    service = ExchangeRateService()
    return await service.list(skip, limit)

@router.put("/{id}", response_model=ExchangeRateModel)
async def update(id: str, data: dict):
    service = ExchangeRateService()
    return await service.update(id, data)

@router.delete("/{id}")
async def delete(id: str):
    service = ExchangeRateService()
    await service.delete(id)
    return {"message": "Deleted successfully"}
