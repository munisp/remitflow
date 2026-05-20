from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Communication Shared Service",
    description="Service for managing shared communication items and templates.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Communication Shared Service is running"}
