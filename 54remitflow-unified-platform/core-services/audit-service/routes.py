"""
API routes for audit-service
"""

from fastapi import APIRouter, HTTPException, Depends
from typing import List
from .models import AuditServiceModel
from .service import AuditServiceService

router = APIRouter(prefix="/api/v1/audit-service", tags=["audit-service"])

@router.post("/", response_model=AuditServiceModel)
async def create(data: dict):
    service = AuditServiceService()
    return await service.create(data)

@router.get("/{id}", response_model=AuditServiceModel)
async def get(id: str):
    service = AuditServiceService()
    return await service.get(id)

@router.get("/", response_model=List[AuditServiceModel])
async def list_all(skip: int = 0, limit: int = 100):
    service = AuditServiceService()
    return await service.list(skip, limit)

@router.put("/{id}", response_model=AuditServiceModel)
async def update(id: str, data: dict):
    service = AuditServiceService()
    return await service.update(id, data)

@router.delete("/{id}")
async def delete(id: str):
    service = AuditServiceService()
    await service.delete(id)
    return {"message": "Deleted successfully"}
