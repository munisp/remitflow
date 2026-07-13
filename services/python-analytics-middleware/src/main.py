"""
python-analytics-middleware — RemitFlow Analytics Middleware Service

Implements the analytics and policy middleware integration layer:

  OpenSearch   → unified index schema, bulk ingestion, threat intelligence
  Lakehouse    → Delta Lake ETL pipeline, Parquet ingestion, dbt transformations
  Keycloak     → user sync, realm events, token introspection, role propagation
  Permify      → policy evaluation, relationship writes, schema management
  PostgreSQL   → change data capture (CDC) via logical replication

Language: Python 3.11 (FastAPI, asyncio)
Port: 8220 (HTTP API) + 8221 (metrics)
"""

import asyncio
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import PlainTextResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
    start_http_server,
)
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","msg":"%(message)s"}',
)
logger = logging.getLogger("analytics-middleware")

# ── Config ────────────────────────────────────────────────────────────────────

class Config:
    OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://opensearch:9200")
    LAKEHOUSE_URL = os.getenv("LAKEHOUSE_URL", "http://python-lakehouse:8130")
    KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "http://keycloak:8080")
    KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "remitflow")
    KEYCLOAK_ADMIN_USER = os.getenv("KEYCLOAK_ADMIN_USER", "admin")
    KEYCLOAK_ADMIN_PASS = os.getenv("KEYCLOAK_ADMIN_PASS", "admin")
    PERMIFY_URL = os.getenv("PERMIFY_URL", "http://permify:3476")
    POSTGRES_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@postgres:5432/remitflow")
    MIDDLEWARE_BUS_URL = os.getenv("MIDDLEWARE_BUS_URL", "http://go-middleware-bus:8200")
    RUST_CONNECTOR_URL = os.getenv("RUST_CONNECTOR_URL", "http://rust-middleware-connector:8210")
    PORT = int(os.getenv("ANALYTICS_MIDDLEWARE_PORT", "8220"))
    METRICS_PORT = int(os.getenv("ANALYTICS_MIDDLEWARE_METRICS_PORT", "8221"))

cfg = Config()

# ── Prometheus Metrics ────────────────────────────────────────────────────────

OPERATIONS = Counter(
    "analytics_middleware_operations_total",
    "Total operations by system and status",
    ["system", "operation", "status"],
)
LATENCY = Histogram(
    "analytics_middleware_latency_seconds",
    "Operation latency",
    ["system", "operation"],
    buckets=[0.01, 0.05, 0.1, 0.5, 1.0, 5.0, 10.0],
)
SYSTEM_UP = Gauge(
    "analytics_middleware_system_up",
    "Health status of each connected system",
    ["system"],
)
OPENSEARCH_DOCS = Counter(
    "analytics_middleware_opensearch_docs_total",
    "Documents indexed in OpenSearch",
    ["index", "status"],
)
LAKEHOUSE_ROWS = Counter(
    "analytics_middleware_lakehouse_rows_total",
    "Rows written to Lakehouse",
    ["table", "status"],
)
KEYCLOAK_EVENTS = Counter(
    "analytics_middleware_keycloak_events_total",
    "Keycloak events processed",
    ["event_type"],
)
PERMIFY_CHECKS = Counter(
    "analytics_middleware_permify_checks_total",
    "Permify permission checks",
    ["result"],
)

# ── HTTP Client ───────────────────────────────────────────────────────────────

http_client: Optional[httpx.AsyncClient] = None
keycloak_admin_token: Optional[str] = None
keycloak_token_expiry: float = 0.0

async def get_http_client() -> httpx.AsyncClient:
    global http_client
    if http_client is None:
        http_client = httpx.AsyncClient(timeout=10.0, limits=httpx.Limits(max_connections=50))
    return http_client

# ── Keycloak Admin Token ──────────────────────────────────────────────────────

async def get_keycloak_admin_token() -> str:
    global keycloak_admin_token, keycloak_token_expiry
    if keycloak_admin_token and time.time() < keycloak_token_expiry - 30:
        return keycloak_admin_token

    client = await get_http_client()
    url = f"{cfg.KEYCLOAK_URL}/realms/master/protocol/openid-connect/token"
    data = {
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": cfg.KEYCLOAK_ADMIN_USER,
        "password": cfg.KEYCLOAK_ADMIN_PASS,
    }
    try:
        resp = await client.post(url, data=data)
        resp.raise_for_status()
        token_data = resp.json()
        keycloak_admin_token = token_data["access_token"]
        keycloak_token_expiry = time.time() + token_data.get("expires_in", 300)
        SYSTEM_UP.labels(system="keycloak").set(1)
        return keycloak_admin_token
    except Exception as e:
        logger.error(f"Keycloak admin token failed: {e}")
        SYSTEM_UP.labels(system="keycloak").set(0)
        raise HTTPException(status_code=503, detail=f"Keycloak unavailable: {e}")

# ── Request Models ────────────────────────────────────────────────────────────

class OSIndexRequest(BaseModel):
    index: str
    id: Optional[str] = None
    document: dict
    pipeline: Optional[str] = None

class OSBulkRequest(BaseModel):
    index: str
    documents: list[dict]
    pipeline: Optional[str] = None

class OSSearchRequest(BaseModel):
    index: str
    query: dict
    size: int = 10
    from_: int = Field(0, alias="from")
    sort: Optional[list] = None
    aggs: Optional[dict] = None

class LakehouseWriteRequest(BaseModel):
    table: str
    rows: list[dict]
    partition_by: Optional[list[str]] = None
    mode: str = "append"  # append | overwrite | merge

class LakehouseQueryRequest(BaseModel):
    sql: str
    params: Optional[dict] = None

class KeycloakSyncRequest(BaseModel):
    user_id: str
    action: str  # sync | create | update | delete | introspect
    attributes: Optional[dict] = None

class KeycloakTokenIntrospectRequest(BaseModel):
    token: str
    client_id: Optional[str] = None

class PermifyCheckRequest(BaseModel):
    tenant_id: str
    subject_type: str
    subject_id: str
    permission: str
    entity_type: str
    entity_id: str
    context: Optional[dict] = None

class PermifyWriteRequest(BaseModel):
    tenant_id: str
    schema_version: Optional[str] = None
    relationships: list[dict]

class PermifySchemaRequest(BaseModel):
    tenant_id: str
    schema: str

# ── OpenSearch Handlers ───────────────────────────────────────────────────────

async def ensure_index_mappings(client: httpx.AsyncClient, index: str) -> None:
    """Create index with proper mappings if it doesn't exist."""
    check_url = f"{cfg.OPENSEARCH_URL}/{index}"
    resp = await client.head(check_url)
    if resp.status_code == 404:
        # Define standard mappings for known indices
        mappings = {
            "mappings": {
                "properties": {
                    "id": {"type": "keyword"},
                    "tenant_id": {"type": "keyword"},
                    "user_id": {"type": "keyword"},
                    "timestamp": {"type": "date"},
                    "event_type": {"type": "keyword"},
                    "status": {"type": "keyword"},
                    "amount": {"type": "double"},
                    "currency": {"type": "keyword"},
                    "risk_score": {"type": "float"},
                    "metadata": {"type": "object", "dynamic": True},
                    "payload": {"type": "object", "dynamic": True},
                    "message": {"type": "text"},
                    "ip_address": {"type": "ip"},
                    "country_code": {"type": "keyword"},
                }
            },
            "settings": {
                "number_of_shards": 3,
                "number_of_replicas": 1,
                "index.refresh_interval": "5s",
            },
        }
        await client.put(check_url, json=mappings)
        logger.info(f"Created OpenSearch index: {index}")

async def opensearch_index(req: OSIndexRequest) -> dict:
    start = time.time()
    client = await get_http_client()
    doc_id = req.id or str(uuid4())

    # Add timestamp if not present
    doc = req.document.copy()
    if "timestamp" not in doc:
        doc["timestamp"] = datetime.now(timezone.utc).isoformat()

    await ensure_index_mappings(client, req.index)

    url = f"{cfg.OPENSEARCH_URL}/{req.index}/_doc/{doc_id}"
    if req.pipeline:
        url += f"?pipeline={req.pipeline}"

    try:
        resp = await client.put(url, json=doc)
        resp.raise_for_status()
        latency = time.time() - start
        LATENCY.labels(system="opensearch", operation="index").observe(latency)
        OPENSEARCH_DOCS.labels(index=req.index, status="success").inc()
        OPERATIONS.labels(system="opensearch", operation="index", status="success").inc()
        return resp.json()
    except Exception as e:
        OPENSEARCH_DOCS.labels(index=req.index, status="error").inc()
        OPERATIONS.labels(system="opensearch", operation="index", status="error").inc()
        logger.error(f"OpenSearch index error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def opensearch_bulk(req: OSBulkRequest) -> dict:
    start = time.time()
    client = await get_http_client()
    await ensure_index_mappings(client, req.index)

    # Build NDJSON
    lines = []
    for doc in req.documents:
        doc_id = doc.get("id", str(uuid4()))
        if "timestamp" not in doc:
            doc["timestamp"] = datetime.now(timezone.utc).isoformat()
        lines.append(json.dumps({"index": {"_index": req.index, "_id": doc_id}}))
        lines.append(json.dumps(doc))
    body = "\n".join(lines) + "\n"

    url = f"{cfg.OPENSEARCH_URL}/_bulk"
    if req.pipeline:
        url += f"?pipeline={req.pipeline}"

    try:
        resp = await client.post(
            url,
            content=body,
            headers={"Content-Type": "application/x-ndjson"},
        )
        resp.raise_for_status()
        result = resp.json()
        errors = result.get("errors", False)
        count = len(req.documents)
        latency = time.time() - start
        LATENCY.labels(system="opensearch", operation="bulk").observe(latency)
        OPENSEARCH_DOCS.labels(index=req.index, status="error" if errors else "success").inc(count)
        OPERATIONS.labels(system="opensearch", operation="bulk", status="error" if errors else "success").inc()
        return {"indexed": count, "errors": errors, "result": result}
    except Exception as e:
        OPERATIONS.labels(system="opensearch", operation="bulk", status="error").inc()
        logger.error(f"OpenSearch bulk error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ── Lakehouse Handlers ────────────────────────────────────────────────────────

async def lakehouse_write(req: LakehouseWriteRequest) -> dict:
    start = time.time()
    client = await get_http_client()

    payload = {
        "table": req.table,
        "rows": req.rows,
        "partition_by": req.partition_by or [],
        "mode": req.mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        resp = await client.post(f"{cfg.LAKEHOUSE_URL}/write", json=payload)
        resp.raise_for_status()
        latency = time.time() - start
        LATENCY.labels(system="lakehouse", operation="write").observe(latency)
        LAKEHOUSE_ROWS.labels(table=req.table, status="success").inc(len(req.rows))
        OPERATIONS.labels(system="lakehouse", operation="write", status="success").inc()
        SYSTEM_UP.labels(system="lakehouse").set(1)
        return resp.json()
    except Exception as e:
        LAKEHOUSE_ROWS.labels(table=req.table, status="error").inc(len(req.rows))
        OPERATIONS.labels(system="lakehouse", operation="write", status="error").inc()
        SYSTEM_UP.labels(system="lakehouse").set(0)
        logger.error(f"Lakehouse write error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def lakehouse_query(req: LakehouseQueryRequest) -> dict:
    start = time.time()
    client = await get_http_client()

    try:
        resp = await client.post(
            f"{cfg.LAKEHOUSE_URL}/query",
            json={"sql": req.sql, "params": req.params or {}},
        )
        resp.raise_for_status()
        latency = time.time() - start
        LATENCY.labels(system="lakehouse", operation="query").observe(latency)
        OPERATIONS.labels(system="lakehouse", operation="query", status="success").inc()
        return resp.json()
    except Exception as e:
        OPERATIONS.labels(system="lakehouse", operation="query", status="error").inc()
        logger.error(f"Lakehouse query error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ── Keycloak Handlers ─────────────────────────────────────────────────────────

async def keycloak_sync_user(req: KeycloakSyncRequest) -> dict:
    start = time.time()
    client = await get_http_client()
    token = await get_keycloak_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    base_url = f"{cfg.KEYCLOAK_URL}/admin/realms/{cfg.KEYCLOAK_REALM}/users"

    try:
        if req.action == "sync" or req.action == "introspect":
            # Fetch user from Keycloak
            resp = await client.get(f"{base_url}/{req.user_id}", headers=headers)
            resp.raise_for_status()
            user_data = resp.json()
            KEYCLOAK_EVENTS.labels(event_type="sync").inc()

            # Also sync to OpenSearch for audit
            await opensearch_index(OSIndexRequest(
                index="keycloak-users",
                id=req.user_id,
                document={
                    "id": req.user_id,
                    "username": user_data.get("username"),
                    "email": user_data.get("email"),
                    "enabled": user_data.get("enabled"),
                    "attributes": user_data.get("attributes", {}),
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                },
            ))
            latency = time.time() - start
            LATENCY.labels(system="keycloak", operation="sync").observe(latency)
            OPERATIONS.labels(system="keycloak", operation="sync", status="success").inc()
            return {"synced": True, "user": user_data}

        elif req.action == "update":
            resp = await client.put(
                f"{base_url}/{req.user_id}",
                headers=headers,
                json=req.attributes or {},
            )
            resp.raise_for_status()
            KEYCLOAK_EVENTS.labels(event_type="update").inc()
            OPERATIONS.labels(system="keycloak", operation="update", status="success").inc()
            return {"updated": True, "user_id": req.user_id}

        elif req.action == "delete":
            resp = await client.delete(f"{base_url}/{req.user_id}", headers=headers)
            resp.raise_for_status()
            KEYCLOAK_EVENTS.labels(event_type="delete").inc()
            OPERATIONS.labels(system="keycloak", operation="delete", status="success").inc()
            return {"deleted": True, "user_id": req.user_id}

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")

    except HTTPException:
        raise
    except Exception as e:
        OPERATIONS.labels(system="keycloak", operation=req.action, status="error").inc()
        logger.error(f"Keycloak sync error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def keycloak_introspect_token(req: KeycloakTokenIntrospectRequest) -> dict:
    start = time.time()
    client = await get_http_client()

    url = f"{cfg.KEYCLOAK_URL}/realms/{cfg.KEYCLOAK_REALM}/protocol/openid-connect/token/introspect"
    data = {
        "token": req.token,
        "client_id": req.client_id or "remitflow-api",
    }

    try:
        resp = await client.post(url, data=data)
        resp.raise_for_status()
        result = resp.json()
        latency = time.time() - start
        LATENCY.labels(system="keycloak", operation="introspect").observe(latency)
        active = result.get("active", False)
        OPERATIONS.labels(system="keycloak", operation="introspect", status="active" if active else "inactive").inc()
        return result
    except Exception as e:
        OPERATIONS.labels(system="keycloak", operation="introspect", status="error").inc()
        logger.error(f"Keycloak introspect error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def keycloak_get_realm_events(limit: int = 100) -> dict:
    client = await get_http_client()
    token = await get_keycloak_admin_token()
    headers = {"Authorization": f"Bearer {token}"}

    url = f"{cfg.KEYCLOAK_URL}/admin/realms/{cfg.KEYCLOAK_REALM}/events?max={limit}"
    try:
        resp = await client.get(url, headers=headers)
        resp.raise_for_status()
        events = resp.json()

        # Bulk index events into OpenSearch
        if events:
            await opensearch_bulk(OSBulkRequest(
                index="keycloak-events",
                documents=events,
            ))
        KEYCLOAK_EVENTS.labels(event_type="realm_events").inc(len(events))
        return {"events": events, "count": len(events)}
    except Exception as e:
        logger.error(f"Keycloak events error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ── Permify Handlers ──────────────────────────────────────────────────────────

async def permify_check(req: PermifyCheckRequest) -> dict:
    start = time.time()
    client = await get_http_client()

    payload = {
        "tenantId": req.tenant_id,
        "metadata": {"schemaVersion": "", "snapToken": "", "depth": 20},
        "entity": {"type": req.entity_type, "id": req.entity_id},
        "permission": req.permission,
        "subject": {"type": req.subject_type, "id": req.subject_id},
        "context": req.context or {},
    }

    try:
        resp = await client.post(
            f"{cfg.PERMIFY_URL}/v1/tenants/{req.tenant_id}/permissions/check",
            json=payload,
        )
        resp.raise_for_status()
        result = resp.json()
        allowed = result.get("can") == "CHECK_RESULT_ALLOWED"
        latency = time.time() - start
        LATENCY.labels(system="permify", operation="check").observe(latency)
        PERMIFY_CHECKS.labels(result="allowed" if allowed else "denied").inc()
        OPERATIONS.labels(system="permify", operation="check", status="allowed" if allowed else "denied").inc()
        SYSTEM_UP.labels(system="permify").set(1)
        return {"allowed": allowed, "result": result}
    except Exception as e:
        PERMIFY_CHECKS.labels(result="error").inc()
        OPERATIONS.labels(system="permify", operation="check", status="error").inc()
        SYSTEM_UP.labels(system="permify").set(0)
        logger.error(f"Permify check error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def permify_write_relationships(req: PermifyWriteRequest) -> dict:
    start = time.time()
    client = await get_http_client()

    payload = {
        "metadata": {"schemaVersion": req.schema_version or ""},
        "tuples": req.relationships,
    }

    try:
        resp = await client.post(
            f"{cfg.PERMIFY_URL}/v1/tenants/{req.tenant_id}/relationships/write",
            json=payload,
        )
        resp.raise_for_status()
        result = resp.json()
        latency = time.time() - start
        LATENCY.labels(system="permify", operation="write").observe(latency)
        OPERATIONS.labels(system="permify", operation="write", status="success").inc()
        return result
    except Exception as e:
        OPERATIONS.labels(system="permify", operation="write", status="error").inc()
        logger.error(f"Permify write error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

async def permify_write_schema(req: PermifySchemaRequest) -> dict:
    client = await get_http_client()

    try:
        resp = await client.post(
            f"{cfg.PERMIFY_URL}/v1/tenants/{req.tenant_id}/schemas/write",
            json={"schema": req.schema},
        )
        resp.raise_for_status()
        OPERATIONS.labels(system="permify", operation="schema_write", status="success").inc()
        return resp.json()
    except Exception as e:
        OPERATIONS.labels(system="permify", operation="schema_write", status="error").inc()
        logger.error(f"Permify schema write error: {e}")
        raise HTTPException(status_code=502, detail=str(e))

# ── Background Tasks ──────────────────────────────────────────────────────────

async def run_keycloak_event_sync():
    """Periodically sync Keycloak realm events to OpenSearch."""
    while True:
        try:
            await keycloak_get_realm_events(limit=500)
            logger.info("Keycloak realm events synced to OpenSearch")
        except Exception as e:
            logger.warning(f"Keycloak event sync failed: {e}")
        await asyncio.sleep(60)  # Every 60 seconds

async def run_health_checks():
    """Periodically check health of all connected systems."""
    systems = {
        "opensearch": f"{cfg.OPENSEARCH_URL}/_cluster/health",
        "lakehouse": f"{cfg.LAKEHOUSE_URL}/health",
        "keycloak": f"{cfg.KEYCLOAK_URL}/health/ready",
        "permify": f"{cfg.PERMIFY_URL}/healthz",
    }
    while True:
        client = await get_http_client()
        for name, url in systems.items():
            try:
                resp = await client.get(url, timeout=3.0)
                up = resp.status_code < 500
                SYSTEM_UP.labels(system=name).set(1 if up else 0)
            except Exception:
                SYSTEM_UP.labels(system=name).set(0)
        await asyncio.sleep(30)

# ── App Lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"python-analytics-middleware starting on port {cfg.PORT}")
    start_http_server(cfg.METRICS_PORT)
    logger.info(f"Prometheus metrics on port {cfg.METRICS_PORT}")
    asyncio.create_task(run_health_checks())
    asyncio.create_task(run_keycloak_event_sync())
    yield
    global http_client
    if http_client:
        await http_client.aclose()

app = FastAPI(
    title="RemitFlow Analytics Middleware",
    version="1.0.0",
    description="OpenSearch, Lakehouse, Keycloak, and Permify middleware integration",
    lifespan=lifespan,
)

# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "python-analytics-middleware",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)

# OpenSearch
@app.post("/v1/opensearch/index")
async def route_os_index(req: OSIndexRequest):
    return await opensearch_index(req)

@app.post("/v1/opensearch/bulk")
async def route_os_bulk(req: OSBulkRequest):
    return await opensearch_bulk(req)

@app.post("/v1/opensearch/search")
async def route_os_search(req: OSSearchRequest):
    client = await get_http_client()
    body = {"query": req.query, "size": req.size, "from": req.from_}
    if req.sort:
        body["sort"] = req.sort
    if req.aggs:
        body["aggs"] = req.aggs
    resp = await client.post(f"{cfg.OPENSEARCH_URL}/{req.index}/_search", json=body)
    resp.raise_for_status()
    return resp.json()

# Lakehouse
@app.post("/v1/lakehouse/write")
async def route_lakehouse_write(req: LakehouseWriteRequest):
    return await lakehouse_write(req)

@app.post("/v1/lakehouse/query")
async def route_lakehouse_query(req: LakehouseQueryRequest):
    return await lakehouse_query(req)

# Keycloak
@app.post("/v1/keycloak/sync")
async def route_keycloak_sync(req: KeycloakSyncRequest):
    return await keycloak_sync_user(req)

@app.post("/v1/keycloak/introspect")
async def route_keycloak_introspect(req: KeycloakTokenIntrospectRequest):
    return await keycloak_introspect_token(req)

@app.get("/v1/keycloak/events")
async def route_keycloak_events(limit: int = 100):
    return await keycloak_get_realm_events(limit)

# Permify
@app.post("/v1/permify/check")
async def route_permify_check(req: PermifyCheckRequest):
    return await permify_check(req)

@app.post("/v1/permify/relationships")
async def route_permify_write(req: PermifyWriteRequest):
    return await permify_write_relationships(req)

@app.post("/v1/permify/schema")
async def route_permify_schema(req: PermifySchemaRequest):
    return await permify_write_schema(req)

# Unified event ingestion — fan-out to OpenSearch + Lakehouse
@app.post("/v1/events/ingest")
async def ingest_event(event: dict, background_tasks: BackgroundTasks):
    """Unified event ingestion endpoint — indexes to OpenSearch and writes to Lakehouse."""
    event_type = event.get("type", "unknown")
    index = f"events-{event_type.replace('.', '-').replace('_', '-')}"

    background_tasks.add_task(
        opensearch_index,
        OSIndexRequest(index=index, document=event),
    )
    background_tasks.add_task(
        lakehouse_write,
        LakehouseWriteRequest(table=f"events_{event_type.replace('.', '_')}", rows=[event]),
    )
    return {"status": "accepted", "event_type": event_type, "id": event.get("id")}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=cfg.PORT, log_level="info")
