from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Supply Chain Service",
    description="Service for tracking items and activities in a supply chain.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Supply Chain Service is running"}
