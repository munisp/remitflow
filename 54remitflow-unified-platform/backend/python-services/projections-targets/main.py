from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Projections and Targets Service",
    description="Service for managing sales/performance targets and generating financial projections.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Projections and Targets Service is running"}
