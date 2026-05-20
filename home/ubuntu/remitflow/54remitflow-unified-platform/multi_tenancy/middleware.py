from fastapi import Request, HTTPException

class MultiTenancyMiddleware:
    async def __call__(self, request: Request, call_next):
        tenant_id = request.headers.get("X-Tenant-ID")
        if not tenant_id:
            raise HTTPException(status_code=400, detail="X-Tenant-ID header is required")

        # In a real-world scenario, you would want to validate the tenant ID
        # and perhaps fetch some tenant-specific configuration from a database.
        request.state.tenant_id = tenant_id

        response = await call_next(request)
        return response
