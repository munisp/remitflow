
from fastapi import FastAPI, Depends, HTTPException
from pydantic import BaseModel
from typing import List

app = FastAPI(
    title="Home Delivery Service",
    description="Manages door-to-door cash delivery logistics, including courier assignment, route optimization, and proof of delivery.",
    version="1.0.0",
)

class DeliveryRequest(BaseModel):
    transaction_id: str
    recipient_address: str
    amount: float
    currency: str

class DeliveryStatus(BaseModel):
    delivery_id: str
    status: str # e.g., PENDING, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED
    courier_id: str = None
    estimated_delivery_time: str = None

# In-memory database for simplicity
deliveries = {}

@app.post("/v1/deliveries", response_model=DeliveryStatus)
async def schedule_delivery(request: DeliveryRequest):
    delivery_id = f"DEL-{request.transaction_id}"
    if delivery_id in deliveries:
        raise HTTPException(status_code=409, detail="Delivery already scheduled for this transaction")
    
    new_delivery = DeliveryStatus(
        delivery_id=delivery_id,
        status="PENDING"
    )
    deliveries[delivery_id] = new_delivery
    # TODO: Integrate with courier management and route optimization services
    return new_delivery

@app.get("/v1/deliveries/{delivery_id}", response_model=DeliveryStatus)
async def get_delivery_status(delivery_id: str):
    if delivery_id not in deliveries:
        raise HTTPException(status_code=404, detail="Delivery not found")
    return deliveries[delivery_id]

@app.post("/v1/deliveries/{delivery_id}/assign")
async def assign_courier(delivery_id: str, courier_id: str):
    if delivery_id not in deliveries:
        raise HTTPException(status_code=404, detail="Delivery not found")
    deliveries[delivery_id].status = "ASSIGNED"
    deliveries[delivery_id].courier_id = courier_id
    return {"message": "Courier assigned successfully"}

@app.post("/v1/deliveries/{delivery_id}/complete")
async def complete_delivery(delivery_id: str, proof_of_delivery: str):
    if delivery_id not in deliveries:
        raise HTTPException(status_code=404, detail="Delivery not found")
    deliveries[delivery_id].status = "DELIVERED"
    # TODO: Store proof_of_delivery securely
    return {"message": "Delivery completed successfully"}

@app.get("/")
async def root():
    return {"service": "Home Delivery Service", "status": "ok"}
