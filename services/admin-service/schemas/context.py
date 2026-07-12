from pydantic import BaseModel


class Context(BaseModel):
    """Bundles per-request header values for passing into service/repo
    methods. Not a DB model."""

    tenant_id: str
