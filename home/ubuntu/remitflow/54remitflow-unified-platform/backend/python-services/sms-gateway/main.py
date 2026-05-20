from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="SMS Gateway Service",
    description="Service for handling SMS-based banking commands and notifications.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "SMS Gateway Service is running"}
