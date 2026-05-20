from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="QR Ticket Verification Service",
    description="Service for creating, managing, and verifying secure QR code-based tickets.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "QR Ticket Verification Service is running"}
