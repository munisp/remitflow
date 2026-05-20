from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Transaction Scoring Service",
    description="Service for scoring transactions based on risk and success probability.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Transaction Scoring Service is running"}
