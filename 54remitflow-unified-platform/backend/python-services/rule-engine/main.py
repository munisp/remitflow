
from fastapi import FastAPI, Response
from app.api.v1 import endpoints
from app.db.database import Base, engine
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.core import health, metrics

# Setup logging as early as possible
setup_logging()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
)

@app.on_event("startup")
def on_startup():
    # Create database tables
    Base.metadata.create_all(bind=engine)

app.include_router(endpoints.router, prefix=settings.API_V1_STR)
app.include_router(health.router)

@app.get("/metrics")
async def metrics_endpoint():
    return Response(content=metrics.generate_latest().decode("utf-8"), media_type="text/plain")

app.middleware("http")(metrics.metrics_middleware(app))

@app.get("/")
async def root():
    return {"message": "Rule Engine Service is running"}

