from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Chart of Accounts Service",
    description="Service for managing the General Ledger and Chart of Accounts.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Chart of Accounts Service is running"}
