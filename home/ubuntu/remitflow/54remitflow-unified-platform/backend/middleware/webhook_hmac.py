"""
Webhook HMAC Signature Validation Middleware
Validates incoming webhooks from Paystack, Flutterwave, Stripe, and Wise
to prevent spoofed payment confirmations.
"""
import hashlib
import hmac
import json
import os
import logging
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

WEBHOOK_SECRETS = {
    "paystack": os.getenv("PAYSTACK_WEBHOOK_SECRET", ""),
    "flutterwave": os.getenv("FLUTTERWAVE_WEBHOOK_SECRET", ""),
    "stripe": os.getenv("STRIPE_WEBHOOK_SECRET", ""),
    "wise": os.getenv("WISE_WEBHOOK_SECRET", ""),
}

WEBHOOK_PATHS = {
    "/api/v1/webhooks/paystack": "paystack",
    "/api/v1/webhooks/flutterwave": "flutterwave",
    "/api/v1/webhooks/stripe": "stripe",
    "/api/v1/webhooks/wise": "wise",
}

def verify_paystack_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload, hashlib.sha512).hexdigest()
    return hmac.compare_digest(expected, signature)

def verify_flutterwave_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

def verify_stripe_signature(payload: bytes, signature_header: str, secret: str) -> bool:
    """Stripe uses a timestamp + signature format: t=timestamp,v1=sig"""
    try:
        parts = {k: v for k, v in (p.split("=", 1) for p in signature_header.split(","))}
        timestamp = parts.get("t", "")
        sig = parts.get("v1", "")
        signed_payload = f"{timestamp}.{payload.decode()}"
        expected = hmac.new(secret.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, sig)
    except Exception:
        return False

def verify_wise_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

VERIFIERS = {
    "paystack": (verify_paystack_signature, "x-paystack-signature"),
    "flutterwave": (verify_flutterwave_signature, "verif-hash"),
    "stripe": (verify_stripe_signature, "stripe-signature"),
    "wise": (verify_wise_signature, "x-signature-sha256"),
}

class WebhookHMACMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        provider = WEBHOOK_PATHS.get(path)
        
        if provider is None:
            return await call_next(request)
        
        secret = WEBHOOK_SECRETS.get(provider, "")
        if not secret:
            logger.error(f"Webhook secret not configured for {provider} — rejecting request")
            return JSONResponse({"error": "Webhook validation not configured"}, status_code=500)
        
        verifier_fn, header_name = VERIFIERS[provider]
        signature = request.headers.get(header_name, "")
        
        if not signature:
            logger.warning(f"Webhook from {provider} missing signature header '{header_name}'")
            return JSONResponse({"error": "Missing signature"}, status_code=401)
        
        body = await request.body()
        
        if not verifier_fn(body, signature, secret):
            logger.warning(f"Webhook HMAC validation FAILED for {provider} from {request.client.host}")
            return JSONResponse({"error": "Invalid signature"}, status_code=401)
        
        logger.info(f"Webhook HMAC validated for {provider}")
        return await call_next(request)
