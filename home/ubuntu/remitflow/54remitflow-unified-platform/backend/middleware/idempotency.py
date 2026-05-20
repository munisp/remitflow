"""
Idempotency Key Middleware
Prevents duplicate transactions on network retries.
Caches responses for POST requests with an Idempotency-Key header for 24 hours.
"""
import json
import hashlib
import logging
import os
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response
import redis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
IDEMPOTENCY_TTL = int(os.getenv("IDEMPOTENCY_TTL_SECONDS", "86400"))  # 24 hours

# Only enforce idempotency on these mutation endpoints
IDEMPOTENCY_PATHS = {
    "/api/v1/transactions/send",
    "/api/v1/transactions/create",
    "/api/v1/payments/initiate",
    "/api/v1/wallets/transfer",
    "/api/v1/airtime/purchase",
    "/api/v1/bills/pay",
    "/api/v1/stablecoin/transfer",
    "/api/v1/wise/transfer",
    "/api/v1/swift/transfer",
}

class IdempotencyMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        try:
            self.redis = redis.from_url(REDIS_URL, decode_responses=True)
        except Exception as e:
            logger.warning(f"Idempotency middleware: Redis connection failed: {e}")
            self.redis = None

    async def dispatch(self, request: Request, call_next):
        if request.method != "POST" or request.url.path not in IDEMPOTENCY_PATHS:
            return await call_next(request)

        idempotency_key = request.headers.get("Idempotency-Key")
        if not idempotency_key:
            # No key provided — allow through but log warning
            logger.warning(f"POST to {request.url.path} without Idempotency-Key header")
            return await call_next(request)

        if len(idempotency_key) > 255:
            return JSONResponse({"error": "Idempotency-Key too long (max 255 chars)"}, status_code=400)

        if self.redis is None:
            return await call_next(request)

        # Build cache key: path + idempotency key + user context
        user_id = request.headers.get("X-User-ID", "anonymous")
        cache_key = f"idempotency:{user_id}:{request.url.path}:{idempotency_key}"

        try:
            cached = self.redis.get(cache_key)
            if cached:
                logger.info(f"Idempotency cache hit for key {idempotency_key[:16]}...")
                cached_data = json.loads(cached)
                return JSONResponse(
                    content=cached_data["body"],
                    status_code=cached_data["status_code"],
                    headers={"X-Idempotency-Replayed": "true"}
                )

            # Mark as processing to handle concurrent requests
            processing_key = f"{cache_key}:processing"
            if not self.redis.set(processing_key, "1", nx=True, ex=30):
                return JSONResponse(
                    {"error": "Request with this Idempotency-Key is already being processed"},
                    status_code=409
                )

            response = await call_next(request)

            # Cache successful responses (2xx)
            if 200 <= response.status_code < 300:
                body_bytes = b""
                async for chunk in response.body_iterator:
                    body_bytes += chunk
                try:
                    body = json.loads(body_bytes)
                    self.redis.setex(
                        cache_key,
                        IDEMPOTENCY_TTL,
                        json.dumps({"status_code": response.status_code, "body": body})
                    )
                except Exception:
                    pass
                self.redis.delete(processing_key)
                return Response(
                    content=body_bytes,
                    status_code=response.status_code,
                    headers=dict(response.headers),
                    media_type=response.media_type
                )

            self.redis.delete(processing_key)
            return response

        except Exception as e:
            logger.error(f"Idempotency middleware error: {e}")
            return await call_next(request)
