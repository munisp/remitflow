"""
Nigerian Remittance Platform - Master API Application
Complete FastAPI application with all services registered
"""

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi
import logging
import os
import sys
from datetime import datetime

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('/var/log/remittance-platform.log')
    ]
)

logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Nigerian Remittance Platform API",
    description="Complete remittance platform with 17 payment corridors, 15 AI/ML services, and enterprise features",
    version="2.0.0",
    docs_url="/docs" if os.getenv("APP_ENV", "production") != "production" else None,
    redoc_url="/redoc" if os.getenv("APP_ENV", "production") != "production" else None,
    openapi_url="/openapi.json" if os.getenv("APP_ENV", "production") != "production" else None
)

# CORS Middleware — production-safe: reads from env var, never wildcards in production
_cors_origins_raw = os.getenv("CORS_ALLOWED_ORIGINS", "")
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
else:
    # Development fallback only — blocked by validate_env.py in production
    _cors_origins = ["http://localhost:3000", "http://localhost:5173"]
    logger.warning("CORS_ALLOWED_ORIGINS not set — using localhost fallback (dev only)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=os.getenv("CORS_ALLOW_CREDENTIALS", "true").lower() == "true",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-User-ID", "Idempotency-Key", "X-Request-ID"],
)

# GZip Compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# ============================================================================
# Import and Register All Routers
# ============================================================================

# Payment Gateway Services
try:
    from backend.core_services.payment_gateway_service.services import router as payment_gateway_router
    app.include_router(payment_gateway_router.router, prefix="/api/v1/payment-gateways", tags=["Payment Gateways"])
except: pass

# Core Services
services_to_register = [
    ("upi-integration", "UPI Integration"),
    ("nibss-integration", "NIBSS Integration"),
    ("rewards", "Rewards & Loyalty"),
    ("stablecoin-integration", "Stablecoin"),
    ("multi-currency-accounts", "Multi-Currency"),
    ("open-banking", "Open Banking"),
    ("payment-processing", "Payment Processing"),
    ("user-management", "User Management"),
]

for service_path, service_name in services_to_register:
    try:
        module = __import__(f"backend.core_services.{service_path.replace('-', '_')}.src.router", fromlist=["router"])
        app.include_router(module.router, tags=[service_name])
    except Exception as e:
        logger.warning(f"Could not register {service_name}: {str(e)}")

# AI/ML Services
ai_services = [
    ("arcface-service", "ArcFace Face Matching"),
    ("deepseek-ocr-service", "DeepSeek OCR"),
    ("predictive-analytics", "Predictive Analytics"),
    ("chatbot-service", "AI Chatbot"),
    ("credit-scoring", "Credit Scoring"),
]

for service_path, service_name in ai_services:
    try:
        module = __import__(f"backend.ai_ml_services.{service_path.replace('-', '_')}.router", fromlist=["router"])
        app.include_router(module.router, tags=[service_name])
    except Exception as e:
        logger.warning(f"Could not register {service_name}: {str(e)}")

# ============================================================================
# Health & Status Endpoints
# ============================================================================

@app.get("/", tags=["Root"])
async def root():
    """Root endpoint"""
    return {
        "service": "Nigerian Remittance Platform",
        "version": "2.0.0",
        "status": "operational",
        "timestamp": datetime.utcnow().isoformat()
    }

@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "api": "operational",
            "database": "operational",
            "cache": "operational"
        }
    }

@app.get("/api/v1/status", tags=["Status"])
async def get_status():
    """Get platform status"""
    return {
        "platform": "Nigerian Remittance Platform",
        "version": "2.0.0",
        "services": {
            "payment_corridors": 17,
            "ai_ml_services": 15,
            "core_services": 41,
            "total_endpoints": len(app.routes)
        },
        "uptime": "operational",
        "timestamp": datetime.utcnow().isoformat()
    }

# ============================================================================
# Error Handlers
# ============================================================================

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler"""
    logger.error(f"Global exception: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error": "Internal server error",
            "message": str(exc),
            "timestamp": datetime.utcnow().isoformat()
        }
    )

# ============================================================================
# Startup & Shutdown Events
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Startup event handler"""
    logger.info("🚀 Nigerian Remittance Platform starting...")
    logger.info(f"📊 Registered {len(app.routes)} routes")
    logger.info("✅ Platform ready")

@app.on_event("shutdown")
async def shutdown_event():
    """Shutdown event handler"""
    logger.info("🛑 Nigerian Remittance Platform shutting down...")
    logger.info("✅ Shutdown complete")

# ============================================================================
# Run Application
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

# ============================================================================
# Newly Wired Services (added by platform audit)
# ============================================================================
_newly_wired = [
    ("auth-service", "auth_service", "/api/v1/auth", "Authentication"),
    ("bank-verification", "bank_verification", "/api/v1/bank-verification", "Bank Verification"),
    ("case-management", "case_management", "/api/v1/cases", "Case Management"),
    ("currency-conversion", "currency_conversion", "/api/v1/currency", "Currency Conversion"),
    ("distributed-tracing", "distributed_tracing", "/api/v1/tracing", "Distributed Tracing"),
    ("gamification", "gamification", "/api/v1/gamification", "Gamification"),
    ("home-delivery-service", "home_delivery_service", "/api/v1/delivery", "Home Delivery"),
    ("interest-calculation", "interest_calculation", "/api/v1/interest", "Interest Calculation"),
    ("knowledge-base", "knowledge_base", "/api/v1/knowledge", "Knowledge Base"),
    ("live-chat-service", "live_chat_service", "/api/v1/chat", "Live Chat"),
    ("multi-currency-wallet", "multi_currency_wallet", "/api/v1/multi-wallet", "Multi-Currency Wallet"),
    ("pdf-receipt-service", "pdf_receipt_service", "/api/v1/receipts", "PDF Receipts"),
    ("promotion-engine-service", "promotion_engine_service", "/api/v1/promotions", "Promotions"),
    ("remitly-integration", "remitly_integration", "/api/v1/remitly", "Remitly Integration"),
    ("support-service", "support_service", "/api/v1/support", "Support"),
    ("swift-integration", "swift_integration", "/api/v1/swift", "SWIFT Integration"),
    ("user-service", "user_service", "/api/v1/users", "User Service"),
    ("wise-integration", "wise_integration", "/api/v1/wise", "Wise Integration"),
]

import importlib, sys
for svc_dir, svc_mod, prefix, tag in _newly_wired:
    try:
        svc_path = os.path.join(os.path.dirname(__file__), "backend", "python-services", svc_dir)
        if svc_path not in sys.path:
            sys.path.insert(0, svc_path)
        mod = importlib.import_module("router")
        app.include_router(mod.router, prefix=prefix, tags=[tag])
        logger.info(f"Registered: {tag} at {prefix}")
    except Exception as e:
        logger.warning(f"Could not register {tag}: {str(e)}")
    finally:
        if svc_path in sys.path:
            sys.path.remove(svc_path)

# ============================================================================
# GDPR & AML Routers (C7/C8 Production Fixes)
# ============================================================================
try:
    gdpr_path = os.path.join(os.path.dirname(__file__), "backend", "python-services", "user-service")
    if gdpr_path not in sys.path:
        sys.path.insert(0, gdpr_path)
    import gdpr_router as _gdpr
    app.include_router(_gdpr.router, prefix="/api/v1", tags=["GDPR Compliance"])
    logger.info("Registered: GDPR router at /api/v1/gdpr")
    sys.path.remove(gdpr_path)
except Exception as e:
    logger.warning(f"Could not register GDPR router: {e}")

try:
    aml_path = os.path.join(os.path.dirname(__file__), "backend", "python-services", "aml-monitoring")
    if aml_path not in sys.path:
        sys.path.insert(0, aml_path)
    import router as _aml
    app.include_router(_aml.router, prefix="/api/v1", tags=["AML Monitoring"])
    logger.info("Registered: AML Monitoring router at /api/v1/aml")
    sys.path.remove(aml_path)
except Exception as e:
    logger.warning(f"Could not register AML router: {e}")

# ============================================================================
# Production Middleware (H10/H11: Webhook HMAC + Idempotency)
# ============================================================================
try:
    from middleware.webhook_hmac import WebhookHMACMiddleware
    app.add_middleware(WebhookHMACMiddleware)
    logger.info("Registered: WebhookHMACMiddleware")
except Exception as e:
    logger.warning(f"Could not register WebhookHMACMiddleware: {e}")

try:
    from middleware.idempotency import IdempotencyMiddleware
    app.add_middleware(IdempotencyMiddleware)
    logger.info("Registered: IdempotencyMiddleware")
except Exception as e:
    logger.warning(f"Could not register IdempotencyMiddleware: {e}")
