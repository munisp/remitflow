import os
import uuid
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional
from enum import Enum

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import httpx

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/inventory-management", tags=["inventory-management"])

WEBHOOK_URL = os.getenv("INVENTORY_WEBHOOK_URL", "")
LOW_STOCK_WEBHOOK_ENABLED = os.getenv("LOW_STOCK_WEBHOOK_ENABLED", "true").lower() == "true"
_webhook_log: List[Dict[str, Any]] = []


class ItemCategory(str, Enum):
    SIM_CARD = "sim_card"
    POS_PAPER = "pos_paper"
    POS_TERMINAL = "pos_terminal"
    BRANDED_MATERIAL = "branded_material"
    ID_CARD_STOCK = "id_card_stock"
    RECEIPT_ROLL = "receipt_roll"
    MARKETING_FLYER = "marketing_flyer"
    SIGNAGE = "signage"
    CASH_BAG = "cash_bag"
    OTHER = "other"


class ItemStatus(str, Enum):
    AVAILABLE = "available"
    ASSIGNED = "assigned"
    IN_TRANSIT = "in_transit"
    DEPLETED = "depleted"
    DAMAGED = "damaged"
    RETURNED = "returned"


class ItemCreate(BaseModel):
    name: str
    category: ItemCategory
    description: Optional[str] = None
    sku: Optional[str] = None
    quantity: int = Field(..., ge=0)
    unit: str = Field(default="piece")
    unit_cost: Optional[float] = None
    currency: str = Field(default="NGN")
    warehouse_id: Optional[str] = None
    reorder_level: int = Field(default=10, ge=0)
    metadata: Optional[Dict[str, Any]] = None


class ItemResponse(BaseModel):
    id: str
    name: str
    category: ItemCategory
    description: Optional[str] = None
    sku: str
    quantity: int
    assigned_quantity: int = 0
    available_quantity: int = 0
    unit: str
    unit_cost: Optional[float] = None
    currency: str
    warehouse_id: Optional[str] = None
    reorder_level: int
    status: ItemStatus
    metadata: Optional[Dict[str, Any]] = None
    created_at: str
    updated_at: str


class AgentAssignment(BaseModel):
    item_id: str
    agent_id: str
    quantity: int = Field(..., gt=0)
    notes: Optional[str] = None


class AgentAssignmentResponse(BaseModel):
    assignment_id: str
    item_id: str
    item_name: str
    agent_id: str
    quantity: int
    status: str
    assigned_at: str
    returned_at: Optional[str] = None
    notes: Optional[str] = None


class TransferRequest(BaseModel):
    item_id: str
    from_agent_id: str
    to_agent_id: str
    quantity: int = Field(..., gt=0)
    reason: Optional[str] = None


_items: Dict[str, ItemResponse] = {}
_assignments: Dict[str, AgentAssignmentResponse] = {}
_agent_inventory: Dict[str, Dict[str, int]] = {}
_sku_counter = 0


def _generate_sku(category: ItemCategory) -> str:
    global _sku_counter
    _sku_counter += 1
    prefix = category.value[:3].upper()
    return f"{prefix}-{_sku_counter:06d}"


def _update_item_status(item: ItemResponse):
    if item.available_quantity <= 0 and item.assigned_quantity > 0:
        item.status = ItemStatus.ASSIGNED
    elif item.quantity <= 0:
        item.status = ItemStatus.DEPLETED
    elif item.available_quantity <= item.reorder_level:
        item.status = ItemStatus.AVAILABLE
    else:
        item.status = ItemStatus.AVAILABLE


async def _check_low_stock_webhook(item: ItemResponse, agent_id: Optional[str] = None):
    if not LOW_STOCK_WEBHOOK_ENABLED:
        return
    if item.available_quantity > item.reorder_level:
        return
    payload = {
        "alert_type": "low_stock",
        "item_id": item.id,
        "item_name": item.name,
        "category": item.category.value,
        "sku": item.sku,
        "available_quantity": item.available_quantity,
        "reorder_level": item.reorder_level,
        "agent_id": agent_id,
        "severity": "critical" if item.available_quantity == 0 else "warning",
        "triggered_at": datetime.utcnow().isoformat(),
    }
    _webhook_log.append(payload)
    if WEBHOOK_URL:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(WEBHOOK_URL, json=payload)
            logger.info(f"Low stock webhook sent for {item.name} (qty={item.available_quantity})")
        except Exception as e:
            logger.warning(f"Low stock webhook failed: {e}")


@router.get("/")
async def root():
    return {"service": "inventory-management", "status": "ok", "total_items": len(_items)}


@router.get("/health")
async def health_check():
    return {"status": "ok"}


@router.post("/items", response_model=ItemResponse)
async def create_item(item: ItemCreate):
    item_id = str(uuid.uuid4())
    sku = item.sku or _generate_sku(item.category)
    now = datetime.utcnow().isoformat()
    response = ItemResponse(
        id=item_id,
        name=item.name,
        category=item.category,
        description=item.description,
        sku=sku,
        quantity=item.quantity,
        assigned_quantity=0,
        available_quantity=item.quantity,
        unit=item.unit,
        unit_cost=item.unit_cost,
        currency=item.currency,
        warehouse_id=item.warehouse_id,
        reorder_level=item.reorder_level,
        status=ItemStatus.AVAILABLE if item.quantity > 0 else ItemStatus.DEPLETED,
        metadata=item.metadata,
        created_at=now,
        updated_at=now,
    )
    _items[item_id] = response
    if response.available_quantity <= response.reorder_level:
        import asyncio
        asyncio.create_task(_check_low_stock_webhook(response))
    return response


@router.get("/items", response_model=List[ItemResponse])
async def list_items(
    category: Optional[ItemCategory] = None,
    status: Optional[ItemStatus] = None,
    warehouse_id: Optional[str] = None,
    low_stock: bool = False,
    skip: int = 0,
    limit: int = 100,
):
    items = list(_items.values())
    if category:
        items = [i for i in items if i.category == category]
    if status:
        items = [i for i in items if i.status == status]
    if warehouse_id:
        items = [i for i in items if i.warehouse_id == warehouse_id]
    if low_stock:
        items = [i for i in items if i.available_quantity <= i.reorder_level]
    return items[skip : skip + limit]


@router.get("/items/{item_id}", response_model=ItemResponse)
async def get_item(item_id: str):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    return _items[item_id]


@router.put("/items/{item_id}", response_model=ItemResponse)
async def update_item(item_id: str, item: ItemCreate):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    existing = _items[item_id]
    existing.name = item.name
    existing.category = item.category
    existing.description = item.description
    existing.quantity = item.quantity
    existing.available_quantity = item.quantity - existing.assigned_quantity
    existing.unit = item.unit
    existing.unit_cost = item.unit_cost
    existing.warehouse_id = item.warehouse_id
    existing.reorder_level = item.reorder_level
    existing.metadata = item.metadata
    existing.updated_at = datetime.utcnow().isoformat()
    _update_item_status(existing)
    return existing


@router.delete("/items/{item_id}")
async def delete_item(item_id: str):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    item = _items[item_id]
    if item.assigned_quantity > 0:
        raise HTTPException(status_code=400, detail=f"Cannot delete item with {item.assigned_quantity} units assigned to agents")
    del _items[item_id]
    return {"status": "deleted", "item_id": item_id}


@router.post("/items/{item_id}/restock")
async def restock_item(item_id: str, quantity: int = Query(..., gt=0)):
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    item = _items[item_id]
    item.quantity += quantity
    item.available_quantity += quantity
    item.updated_at = datetime.utcnow().isoformat()
    _update_item_status(item)
    return {"item_id": item_id, "new_quantity": item.quantity, "available": item.available_quantity}


@router.post("/assign-agent", response_model=AgentAssignmentResponse)
async def assign_to_agent(request: AgentAssignment):
    if request.item_id not in _items:
        raise HTTPException(status_code=404, detail="Item not found")
    item = _items[request.item_id]
    if item.available_quantity < request.quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Insufficient stock: {item.available_quantity} available, {request.quantity} requested",
        )

    assignment_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    item.assigned_quantity += request.quantity
    item.available_quantity -= request.quantity
    item.updated_at = now
    _update_item_status(item)
    import asyncio
    asyncio.create_task(_check_low_stock_webhook(item, request.agent_id))

    _agent_inventory.setdefault(request.agent_id, {})
    _agent_inventory[request.agent_id][request.item_id] = (
        _agent_inventory[request.agent_id].get(request.item_id, 0) + request.quantity
    )

    assignment = AgentAssignmentResponse(
        assignment_id=assignment_id,
        item_id=request.item_id,
        item_name=item.name,
        agent_id=request.agent_id,
        quantity=request.quantity,
        status="assigned",
        assigned_at=now,
        notes=request.notes,
    )
    _assignments[assignment_id] = assignment
    return assignment


@router.post("/return-from-agent")
async def return_from_agent(
    assignment_id: str,
    quantity: Optional[int] = None,
    condition: str = Query(default="good", description="good|damaged"),
):
    if assignment_id not in _assignments:
        raise HTTPException(status_code=404, detail="Assignment not found")
    assignment = _assignments[assignment_id]
    return_qty = quantity or assignment.quantity

    if return_qty > assignment.quantity:
        raise HTTPException(status_code=400, detail="Return quantity exceeds assigned quantity")

    item = _items.get(assignment.item_id)
    if item:
        item.assigned_quantity -= return_qty
        if condition == "good":
            item.available_quantity += return_qty
        else:
            item.quantity -= return_qty
        item.updated_at = datetime.utcnow().isoformat()
        _update_item_status(item)

    agent_inv = _agent_inventory.get(assignment.agent_id, {})
    current = agent_inv.get(assignment.item_id, 0)
    agent_inv[assignment.item_id] = max(0, current - return_qty)

    assignment.quantity -= return_qty
    if assignment.quantity <= 0:
        assignment.status = "returned"
        assignment.returned_at = datetime.utcnow().isoformat()

    return {
        "assignment_id": assignment_id,
        "returned_quantity": return_qty,
        "condition": condition,
        "remaining_assigned": assignment.quantity,
    }


@router.post("/transfer", response_model=AgentAssignmentResponse)
async def transfer_between_agents(request: TransferRequest):
    from_inv = _agent_inventory.get(request.from_agent_id, {})
    current_qty = from_inv.get(request.item_id, 0)
    if current_qty < request.quantity:
        raise HTTPException(
            status_code=400,
            detail=f"Agent {request.from_agent_id} only has {current_qty} units of item {request.item_id}",
        )

    from_inv[request.item_id] = current_qty - request.quantity

    _agent_inventory.setdefault(request.to_agent_id, {})
    _agent_inventory[request.to_agent_id][request.item_id] = (
        _agent_inventory[request.to_agent_id].get(request.item_id, 0) + request.quantity
    )

    assignment_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    item = _items.get(request.item_id)
    assignment = AgentAssignmentResponse(
        assignment_id=assignment_id,
        item_id=request.item_id,
        item_name=item.name if item else "unknown",
        agent_id=request.to_agent_id,
        quantity=request.quantity,
        status="transferred",
        assigned_at=now,
        notes=f"Transferred from agent {request.from_agent_id}. {request.reason or ''}".strip(),
    )
    _assignments[assignment_id] = assignment
    return assignment


@router.get("/agent/{agent_id}")
async def get_agent_inventory(agent_id: str):
    agent_inv = _agent_inventory.get(agent_id, {})
    items = []
    for item_id, qty in agent_inv.items():
        if qty <= 0:
            continue
        item = _items.get(item_id)
        items.append({
            "item_id": item_id,
            "item_name": item.name if item else "unknown",
            "category": item.category.value if item else "unknown",
            "quantity": qty,
            "unit": item.unit if item else "piece",
        })
    return {
        "agent_id": agent_id,
        "total_items": len(items),
        "inventory": items,
    }


@router.get("/agent/{agent_id}/assignments")
async def get_agent_assignments(
    agent_id: str,
    status: Optional[str] = None,
):
    assignments = [a for a in _assignments.values() if a.agent_id == agent_id]
    if status:
        assignments = [a for a in assignments if a.status == status]
    return {"agent_id": agent_id, "total": len(assignments), "assignments": [a.dict() for a in assignments]}


@router.get("/search")
async def search_items(
    query: str,
    category: Optional[ItemCategory] = None,
):
    results = []
    q = query.lower()
    for item in _items.values():
        if q in item.name.lower() or q in (item.description or "").lower() or q in item.sku.lower():
            if category and item.category != category:
                continue
            results.append(item)
    return {"query": query, "total": len(results), "items": results}


@router.get("/stats")
async def get_statistics():
    total_items = len(_items)
    total_quantity = sum(i.quantity for i in _items.values())
    total_assigned = sum(i.assigned_quantity for i in _items.values())
    total_available = sum(i.available_quantity for i in _items.values())
    low_stock = [i for i in _items.values() if i.available_quantity <= i.reorder_level and i.quantity > 0]
    depleted = [i for i in _items.values() if i.quantity <= 0]

    by_category = {}
    for item in _items.values():
        cat = item.category.value
        by_category.setdefault(cat, {"count": 0, "total_qty": 0, "assigned": 0})
        by_category[cat]["count"] += 1
        by_category[cat]["total_qty"] += item.quantity
        by_category[cat]["assigned"] += item.assigned_quantity

    agents_with_inventory = len([a for a, inv in _agent_inventory.items() if any(v > 0 for v in inv.values())])

    total_value = sum((i.unit_cost or 0) * i.quantity for i in _items.values())

    return {
        "total_items": total_items,
        "total_quantity": total_quantity,
        "total_assigned": total_assigned,
        "total_available": total_available,
        "low_stock_items": len(low_stock),
        "depleted_items": len(depleted),
        "by_category": by_category,
        "agents_with_inventory": agents_with_inventory,
        "total_assignments": len(_assignments),
        "total_inventory_value": round(total_value, 2),
    }


@router.post("/process")
async def process_data(data: Dict[str, Any]):
    action = data.get("action")
    if action == "bulk_assign":
        results = []
        for assignment in data.get("assignments", []):
            req = AgentAssignment(**assignment)
            result = await assign_to_agent(req)
            results.append(result.dict())
        return {"processed": len(results), "results": results}
    elif action == "bulk_restock":
        results = []
        for restock in data.get("items", []):
            item_id = restock["item_id"]
            qty = restock["quantity"]
            result = await restock_item(item_id, qty)
            results.append(result)
        return {"processed": len(results), "results": results}
    return {"status": "unknown_action", "action": action}


@router.get("/webhook-log")
async def get_webhook_log(limit: int = Query(default=50, le=500)):
    return {
        "total": len(_webhook_log),
        "webhook_url_configured": bool(WEBHOOK_URL),
        "enabled": LOW_STOCK_WEBHOOK_ENABLED,
        "alerts": _webhook_log[-limit:],
    }


@router.get("/low-stock-alerts")
async def get_low_stock_alerts():
    alerts = []
    for item in _items.values():
        if item.available_quantity <= item.reorder_level and item.quantity > 0:
            alerts.append({
                "item_id": item.id,
                "item_name": item.name,
                "category": item.category.value,
                "sku": item.sku,
                "available": item.available_quantity,
                "reorder_level": item.reorder_level,
                "severity": "critical" if item.available_quantity == 0 else "warning",
            })
    return {"total_alerts": len(alerts), "alerts": alerts}

