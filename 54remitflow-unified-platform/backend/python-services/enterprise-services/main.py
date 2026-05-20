from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="Enterprise Services",
    description="A collection of services for enterprise customers, including bulk payments, payroll, and white-label APIs.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "Enterprise Services are running"}
