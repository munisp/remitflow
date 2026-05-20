
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(
    title="Promotion Engine Service",
    description="Manages promotional codes, vouchers, and discounts for remittance transactions.",
    version="1.0.0",
)

class PromoCode(BaseModel):
    code: str
    discount_percentage: float
    max_discount: float
    is_active: bool = True
    usage_count: int = 0

class ApplyPromoRequest(BaseModel):
    code: str
    transaction_amount: float

class ApplyPromoResponse(BaseModel):
    original_amount: float
    discount_applied: float
    final_amount: float

# In-memory database for simplicity
promo_codes = {
    "FIRSTFREE": PromoCode(code="FIRSTFREE", discount_percentage=100.0, max_discount=10.0), # 100% off fee up to $10
    "SAVE10": PromoCode(code="SAVE10", discount_percentage=10.0, max_discount=50.0), # 10% off fee up to $50
}

@app.post("/v1/promos/apply", response_model=ApplyPromoResponse)
async def apply_promo_code(request: ApplyPromoRequest):
    if request.code not in promo_codes:
        raise HTTPException(status_code=404, detail="Promo code not found")
    
    promo = promo_codes[request.code]
    if not promo.is_active:
        raise HTTPException(status_code=400, detail="Promo code is not active")

    discount = (request.transaction_amount * promo.discount_percentage) / 100
    if discount > promo.max_discount:
        discount = promo.max_discount
        
    final_amount = request.transaction_amount - discount
    
    promo.usage_count += 1

    return ApplyPromoResponse(
        original_amount=request.transaction_amount,
        discount_applied=discount,
        final_amount=final_amount
    )

@app.get("/v1/promos/{code}", response_model=PromoCode)
async def get_promo_code(code: str):
    if code not in promo_codes:
        raise HTTPException(status_code=404, detail="Promo code not found")
    return promo_codes[code]

@app.get("/")
async def root():
    return {"service": "Promotion Engine Service", "status": "ok"}
