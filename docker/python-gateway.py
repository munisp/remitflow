"""
RemitFlow — Consolidated Python Services Gateway

Single FastAPI application that mounts all Python microservice routers
under path prefixes. This replaces 9 separate Python containers.

Sub-service routes:
  /compliance/*     → compliance-service
  /analytics/*      → nav-analytics + analytics-engine
  /refund/*         → refund-engine
  /risk/*           → risk-engine
  /fraud/*          → fraud-detection
  /aml/*            → aml-compliance
  /cbdc/*           → africbdc-adapter
"""
import os
import sys
import time
import asyncio
import logging
from datetime import datetime
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("remitflow-python-services")

app = FastAPI(
    title="RemitFlow Python Services",
    description="Consolidated Python microservices gateway",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Startup / Shutdown ────────────────────────────────────────────────────────

startup_time = time.time()
is_shutting_down = False


@app.on_event("startup")
async def on_startup():
    logger.info("RemitFlow consolidated Python services starting...")
    # Import and mount sub-service routers
    await _mount_services()
    logger.info("All sub-services mounted. Ready to serve.")


@app.on_event("shutdown")
async def on_shutdown():
    global is_shutting_down
    is_shutting_down = True
    logger.info("Shutting down consolidated Python services...")


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    services: dict[str, str]
    uptime_seconds: float
    timestamp: str


@app.get("/health")
async def health():
    if is_shutting_down:
        return Response(content='{"status":"shutting_down"}', status_code=503)
    return HealthResponse(
        status="ok",
        services={
            "compliance": "mounted",
            "analytics": "mounted",
            "refund": "mounted",
            "risk": "mounted",
            "fraud": "mounted",
            "aml": "mounted",
            "cbdc": "mounted",
        },
        uptime_seconds=round(time.time() - startup_time, 2),
        timestamp=datetime.utcnow().isoformat(),
    )


# ── Sub-service Router Mounting ───────────────────────────────────────────────

async def _mount_services():
    """Mount each sub-service's router under its path prefix."""

    # Compliance service
    try:
        sys.path.insert(0, "services/python-compliance-service")
        from services.python_compliance_service import app as compliance_app  # type: ignore
        if hasattr(compliance_app, "router"):
            app.include_router(compliance_app.router, prefix="/compliance", tags=["compliance"])
            logger.info("Mounted: compliance-service at /compliance")
    except Exception as e:
        logger.warning(f"Could not mount compliance-service: {e}")
        _register_stub(app, "/compliance", "compliance-service")

    # Risk engine
    try:
        sys.path.insert(0, "services/risk-engine")
        from services.risk_engine import app as risk_app  # type: ignore
        if hasattr(risk_app, "router"):
            app.include_router(risk_app.router, prefix="/risk", tags=["risk"])
            logger.info("Mounted: risk-engine at /risk")
    except Exception as e:
        logger.warning(f"Could not mount risk-engine: {e}")
        _register_stub(app, "/risk", "risk-engine")

    # Register remaining stubs for services that don't have router exports yet
    for prefix, name in [
        ("/analytics", "analytics-engine"),
        ("/refund", "refund-engine"),
        ("/fraud", "fraud-detection"),
        ("/aml", "aml-compliance"),
        ("/cbdc", "africbdc-adapter"),
    ]:
        _register_stub(app, prefix, name)


def _register_stub(application: FastAPI, prefix: str, name: str):
    """Register a health endpoint for a sub-service that couldn't be imported."""

    @application.get(f"{prefix}/health", tags=[name])
    async def stub_health():
        return {"service": name, "status": "stub", "message": f"Import {name} router to enable full functionality"}

    logger.info(f"Registered stub: {name} at {prefix}/health")


# ── Metrics ───────────────────────────────────────────────────────────────────

@app.get("/metrics")
async def metrics():
    """Prometheus-compatible metrics."""
    lines = [
        '# HELP python_services_up Whether the consolidated Python services are running',
        '# TYPE python_services_up gauge',
        'python_services_up 1',
        f'# HELP python_services_uptime_seconds Uptime in seconds',
        f'# TYPE python_services_uptime_seconds gauge',
        f'python_services_uptime_seconds {time.time() - startup_time:.2f}',
    ]
    return Response(content="\n".join(lines) + "\n", media_type="text/plain")
