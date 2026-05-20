#!/usr/bin/env python3
"""
openappsec Bridge Service for APISIX
Provides HTTP API for APISIX plugin to communicate with openappsec
"""

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import httpx
import logging
from typing import Dict, Any, Optional
from datetime import datetime
import asyncio
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from fastapi.responses import Response

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
requests_total = Counter(
    'openappsec_requests_total',
    'Total number of requests inspected',
    ['policy', 'verdict']
)
threats_detected = Counter(
    'openappsec_threats_detected_total',
    'Total number of threats detected',
    ['threat_type', 'severity']
)
inspection_duration = Histogram(
    'openappsec_inspection_duration_seconds',
    'Request inspection duration',
    ['policy']
)
blocked_requests = Counter(
    'openappsec_blocked_requests_total',
    'Total number of blocked requests',
    ['threat_type']
)

app = FastAPI(title="openappsec Bridge Service", version="1.0.0")

# Configuration
OPENAPPSEC_MANAGEMENT_URL = "http://openappsec-management:8443"
OPENAPPSEC_AGENT_URL = "http://openappsec-agent:8080"
DEFAULT_TIMEOUT = 5.0

class OpenAppsecClient:
    """Client for communicating with openappsec"""
    
    def __init__(self, agent_url: str, management_url: str):
        self.agent_url = agent_url.rstrip('/')
        self.management_url = management_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=DEFAULT_TIMEOUT)
    
    async def inspect_request(self, request_data: Dict[str, Any]) -> Dict[str, Any]:
        """Send request to openappsec for inspection"""
        try:
            start_time = datetime.utcnow()
            
            # Call openappsec agent
            response = await self.client.post(
                f"{self.agent_url}/api/v1/inspect",
                json=request_data,
                headers={"Content-Type": "application/json"}
            )
            
            duration = (datetime.utcnow() - start_time).total_seconds()
            
            if response.status_code != 200:
                logger.error(f"openappsec returned error: {response.status_code}")
                return self._create_error_verdict("inspection_failed", duration)
            
            verdict = response.json()
            verdict['latency_ms'] = duration * 1000
            
            # Update metrics
            policy = request_data.get('policy_name', 'default')
            inspection_duration.labels(policy=policy).observe(duration)
            
            action = verdict.get('action', 'allow')
            requests_total.labels(policy=policy, verdict=action).inc()
            
            if verdict.get('threat_detected'):
                threat_type = verdict.get('threat_type', 'unknown')
                severity = verdict.get('severity', 'medium')
                threats_detected.labels(threat_type=threat_type, severity=severity).inc()
                
                if action == 'block':
                    blocked_requests.labels(threat_type=threat_type).inc()
            
            return verdict
            
        except httpx.TimeoutException:
            logger.error("openappsec request timeout")
            return self._create_error_verdict("timeout", DEFAULT_TIMEOUT)
        except Exception as e:
            logger.error(f"Error inspecting request: {e}")
            return self._create_error_verdict("error", 0)
    
    def _create_error_verdict(self, error_type: str, duration: float) -> Dict[str, Any]:
        """Create error verdict when inspection fails"""
        return {
            "action": "allow",  # Fail open for availability
            "threat_detected": False,
            "error": error_type,
            "latency_ms": duration * 1000,
            "timestamp": datetime.utcnow().isoformat()
        }
    
    async def get_policy(self, policy_name: str) -> Optional[Dict[str, Any]]:
        """Get security policy from openappsec"""
        try:
            response = await self.client.get(
                f"{self.management_url}/api/v1/policies/{policy_name}"
            )
            if response.status_code == 200:
                return response.json()
            return None
        except Exception as e:
            logger.error(f"Error fetching policy: {e}")
            return None
    
    async def close(self):
        """Close HTTP client"""
        await self.client.aclose()

# Initialize client
appsec_client = OpenAppsecClient(OPENAPPSEC_AGENT_URL, OPENAPPSEC_MANAGEMENT_URL)

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    await appsec_client.close()

@app.post("/api/v1/inspect")
async def inspect_request(request: Request):
    """
    Inspect incoming request for security threats
    
    Request body:
    {
        "method": "GET",
        "uri": "/api/users",
        "headers": {...},
        "body": "...",
        "remote_addr": "1.2.3.4",
        "server_name": "api.example.com",
        "policy_name": "api-protection",
        "timestamp": 1234567890
    }
    
    Response:
    {
        "action": "allow|block",
        "threat_detected": true|false,
        "threat_id": "...",
        "threat_type": "sql_injection|xss|...",
        "severity": "low|medium|high|critical",
        "description": "...",
        "security_headers": {...},
        "latency_ms": 12.5
    }
    """
    try:
        request_data = await request.json()
        
        # Validate required fields
        required_fields = ['method', 'uri', 'headers', 'remote_addr']
        for field in required_fields:
            if field not in request_data:
                raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
        
        # Inspect request
        verdict = await appsec_client.inspect_request(request_data)
        
        return JSONResponse(content=verdict)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error processing inspection request: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.get("/api/v1/policies/{policy_name}")
async def get_policy(policy_name: str):
    """Get security policy details"""
    policy = await appsec_client.get_policy(policy_name)
    if policy:
        return JSONResponse(content=policy)
    raise HTTPException(status_code=404, detail="Policy not found")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        # Check openappsec agent connectivity
        response = await appsec_client.client.get(
            f"{appsec_client.agent_url}/health",
            timeout=2.0
        )
        if response.status_code == 200:
            return {"status": "healthy", "openappsec": "connected"}
        else:
            return {"status": "degraded", "openappsec": "unhealthy"}
    except:
        return {"status": "degraded", "openappsec": "disconnected"}

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "openappsec Bridge Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "inspect": "/api/v1/inspect",
            "policies": "/api/v1/policies/{policy_name}",
            "health": "/health",
            "metrics": "/metrics"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000, log_level="info")

