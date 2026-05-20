from fastapi import FastAPI
from .router import router

app = FastAPI(
    title="CDP Service",
    description="Customer Data Platform service for managing user data and events.",
    version="1.0.0",
)

app.include_router(router)

@app.get("/")
async def root():
    return {"message": "CDP Service is running"}
