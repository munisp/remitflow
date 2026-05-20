from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Security Services",
    description="A collection of security-related services, including compliance, KYC, and advanced cryptography.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Security Services are running"}
