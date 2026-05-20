from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Financial Services",
    description="A collection of value-added financial services, including bill payments, crypto trading, insurance, and lending.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Financial Services are running"}
