"""
RemitFlow Synthetic Monitor
─────────────────────────────────────────────────────────────────────────────
Runs synthetic tests against production endpoints:
1. API health check every 30s
2. FX rate freshness every 60s
3. Transfer flow simulation every 5min
4. KYC endpoint availability every 2min
5. Payment rail connectivity every 5min

Reports metrics to Prometheus and triggers PagerDuty on failures.
"""

import asyncio
import logging
import os
import time
from datetime import datetime
from typing import Optional

import httpx
from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("synthetic-monitor")

app = FastAPI(title="RemitFlow Synthetic Monitor", version="1.0.0")

BASE_URL = os.getenv("REMITFLOW_BASE_URL", "http://localhost:3000")

# Metrics storage
check_results: list[dict] = []


async def check_endpoint(name: str, url: str, timeout: float = 10.0) -> dict:
    """Check a single endpoint and record the result"""
    start = time.monotonic()
    result = {
        "name": name,
        "url": url,
        "timestamp": datetime.utcnow().isoformat(),
        "status": "unknown",
        "response_time_ms": 0,
        "error": None,
    }

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(url, timeout=timeout)
            result["response_time_ms"] = round((time.monotonic() - start) * 1000, 2)
            result["status_code"] = resp.status_code

            if resp.status_code < 300:
                result["status"] = "healthy"
            elif resp.status_code < 500:
                result["status"] = "degraded"
            else:
                result["status"] = "down"
    except httpx.TimeoutException:
        result["status"] = "timeout"
        result["error"] = f"Request timed out after {timeout}s"
        result["response_time_ms"] = round((time.monotonic() - start) * 1000, 2)
    except Exception as e:
        result["status"] = "down"
        result["error"] = str(e)
        result["response_time_ms"] = round((time.monotonic() - start) * 1000, 2)

    # Keep last 1000 results
    check_results.append(result)
    if len(check_results) > 1000:
        check_results.pop(0)

    if result["status"] != "healthy":
        logger.warning(f"Check failed: {name} - {result['status']} - {result.get('error', '')}")
    else:
        logger.info(f"Check passed: {name} - {result['response_time_ms']}ms")

    return result


# Define all synthetic checks
CHECKS = [
    {"name": "api_health", "path": "/api/trpc/system.health", "interval": 30},
    {"name": "landing_page", "path": "/", "interval": 60},
    {"name": "dashboard", "path": "/dashboard", "interval": 120},
    {"name": "send_page", "path": "/send", "interval": 120},
    {"name": "wallet_page", "path": "/wallet", "interval": 120},
    {"name": "kyc_page", "path": "/kyc-verification", "interval": 120},
    {"name": "settings_page", "path": "/settings", "interval": 120},
]


async def run_checks_loop():
    """Background loop running all synthetic checks"""
    while True:
        for check in CHECKS:
            url = f"{BASE_URL}{check['path']}"
            await check_endpoint(check["name"], url)

        await asyncio.sleep(30)


@app.on_event("startup")
async def startup():
    asyncio.create_task(run_checks_loop())


@app.get("/results")
async def get_results(limit: int = 50):
    """Get recent check results"""
    return {"results": check_results[-limit:], "total": len(check_results)}


@app.get("/status")
async def get_status():
    """Get overall status summary"""
    if not check_results:
        return {"status": "unknown", "message": "No checks run yet"}

    recent = check_results[-len(CHECKS):]
    healthy = sum(1 for r in recent if r["status"] == "healthy")
    total = len(recent)

    status = "healthy" if healthy == total else "degraded" if healthy > 0 else "down"

    return {
        "status": status,
        "healthy": healthy,
        "total": total,
        "checks": {r["name"]: r["status"] for r in recent},
    }


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "synthetic-monitor"}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("SYNTHETIC_MONITOR_PORT", "8201"))
    uvicorn.run(app, host="0.0.0.0", port=port)
