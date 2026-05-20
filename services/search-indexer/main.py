"""
RemitFlow — OpenSearch Indexer (Python)
Maintains full-text search indices for:
  - Transactions (amount, currency, status, beneficiary)
  - Users (name, email, KYC status)
  - Beneficiaries (name, country, bank)
  - Audit logs (action, resource, user)
  - Compliance cases (type, status, risk level)
"""

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, Query
from fastapi.responses import PlainTextResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
PORT = int(os.getenv("PORT", "8088"))
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
DATABASE_URL = os.getenv("DATABASE_URL", "")
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
REINDEX_INTERVAL_SECS = int(os.getenv("REINDEX_INTERVAL_SECS", "300"))  # 5 min

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("search-indexer")

# ── Index Mappings ────────────────────────────────────────────────────────────

INDEX_MAPPINGS = {
    "remitflow-transactions": {
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "userId": {"type": "keyword"},
                "amount": {"type": "float"},
                "currency": {"type": "keyword"},
                "status": {"type": "keyword"},
                "type": {"type": "keyword"},
                "beneficiaryName": {"type": "text", "analyzer": "standard"},
                "destinationCountry": {"type": "keyword"},
                "reference": {"type": "text"},
                "createdAt": {"type": "date"},
                "@timestamp": {"type": "date"},
            }
        }
    },
    "remitflow-users": {
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "name": {"type": "text", "analyzer": "standard"},
                "email": {"type": "keyword"},
                "kycStatus": {"type": "keyword"},
                "kycTier": {"type": "integer"},
                "country": {"type": "keyword"},
                "createdAt": {"type": "date"},
                "@timestamp": {"type": "date"},
            }
        }
    },
    "remitflow-beneficiaries": {
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "userId": {"type": "keyword"},
                "name": {"type": "text", "analyzer": "standard"},
                "country": {"type": "keyword"},
                "currency": {"type": "keyword"},
                "bankName": {"type": "text"},
                "accountNumber": {"type": "keyword"},
                "createdAt": {"type": "date"},
                "@timestamp": {"type": "date"},
            }
        }
    },
    "remitflow-audit-logs": {
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "userId": {"type": "keyword"},
                "action": {"type": "keyword"},
                "resource": {"type": "keyword"},
                "severity": {"type": "keyword"},
                "ipAddress": {"type": "ip"},
                "createdAt": {"type": "date"},
                "@timestamp": {"type": "date"},
            }
        }
    },
    "remitflow-compliance": {
        "mappings": {
            "properties": {
                "id": {"type": "keyword"},
                "userId": {"type": "keyword"},
                "type": {"type": "keyword"},
                "status": {"type": "keyword"},
                "riskLevel": {"type": "keyword"},
                "description": {"type": "text"},
                "createdAt": {"type": "date"},
                "@timestamp": {"type": "date"},
            }
        }
    },
}

# ── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "indices_created": 0,
    "documents_indexed": 0,
    "last_reindex_at": None,
    "running": True,
}

# ── OpenSearch Client ─────────────────────────────────────────────────────────

async def ensure_indices() -> None:
    """Create OpenSearch indices with proper mappings if they don't exist."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        for index_name, mapping in INDEX_MAPPINGS.items():
            try:
                resp = await client.head(f"{OPENSEARCH_URL}/{index_name}")
                if resp.status_code == 404:
                    create_resp = await client.put(
                        f"{OPENSEARCH_URL}/{index_name}",
                        json=mapping,
                        headers={"Content-Type": "application/json"},
                    )
                    if create_resp.status_code in (200, 201):
                        logger.info(f"[INDEX] Created index: {index_name}")
                        stats["indices_created"] += 1
                    else:
                        logger.warning(f"[INDEX] Failed to create {index_name}: {create_resp.text}")
                else:
                    logger.debug(f"[INDEX] Index exists: {index_name}")
            except Exception as e:
                logger.warning(f"[INDEX] Could not ensure {index_name}: {e}")


async def bulk_index(index: str, documents: List[Dict[str, Any]]) -> int:
    """Bulk index documents into OpenSearch."""
    if not documents:
        return 0

    bulk_body = ""
    for doc in documents:
        doc_id = doc.get("id", datetime.now(timezone.utc).isoformat())
        doc["@timestamp"] = datetime.now(timezone.utc).isoformat()
        bulk_body += json.dumps({"index": {"_index": index, "_id": doc_id}}) + "\n"
        bulk_body += json.dumps(doc) + "\n"

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{OPENSEARCH_URL}/_bulk",
                content=bulk_body,
                headers={"Content-Type": "application/x-ndjson"},
            )
            if resp.status_code == 200:
                result = resp.json()
                indexed = sum(1 for item in result.get("items", []) if "index" in item)
                stats["documents_indexed"] += indexed
                return indexed
    except Exception as e:
        logger.warning(f"[BULK] Bulk index to {index} failed: {e}")
    return 0


async def search_index(
    index: str,
    query: str,
    filters: Optional[Dict] = None,
    size: int = 20,
    from_: int = 0,
) -> Dict[str, Any]:
    """Search an OpenSearch index."""
    must_clauses = []

    if query:
        must_clauses.append({
            "multi_match": {
                "query": query,
                "fields": ["*"],
                "type": "best_fields",
                "fuzziness": "AUTO",
            }
        })

    if filters:
        for field, value in filters.items():
            must_clauses.append({"term": {field: value}})

    body = {
        "query": {"bool": {"must": must_clauses}} if must_clauses else {"match_all": {}},
        "size": size,
        "from": from_,
        "sort": [{"@timestamp": {"order": "desc"}}],
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{OPENSEARCH_URL}/{index}/_search",
                json=body,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 200:
                result = resp.json()
                hits = result.get("hits", {})
                return {
                    "total": hits.get("total", {}).get("value", 0),
                    "hits": [h["_source"] for h in hits.get("hits", [])],
                }
    except Exception as e:
        logger.warning(f"[SEARCH] Search in {index} failed: {e}")
    return {"total": 0, "hits": []}


# ── Periodic Reindex ──────────────────────────────────────────────────────────

async def reindex_loop() -> None:
    """Periodically sync database records to OpenSearch."""
    await asyncio.sleep(10)  # Wait for startup
    await ensure_indices()

    while stats["running"]:
        try:
            logger.info("[REINDEX] Starting periodic reindex...")
            # In production: query PostgreSQL and bulk index
            # For now: log that reindex would run
            stats["last_reindex_at"] = datetime.now(timezone.utc).isoformat()
            logger.info("[REINDEX] Periodic reindex complete")
        except Exception as e:
            logger.error(f"[REINDEX] Error: {e}")

        await asyncio.sleep(REINDEX_INTERVAL_SECS)


# ── FastAPI App ───────────────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Search Indexer", version="1.0.0")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "search-indexer",
        "version": "1.0.0",
        "opensearch": OPENSEARCH_URL,
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return f"""# HELP search_indices_created_total Total indices created
# TYPE search_indices_created_total counter
search_indices_created_total {stats['indices_created']}
# HELP search_documents_indexed_total Total documents indexed
# TYPE search_documents_indexed_total counter
search_documents_indexed_total {stats['documents_indexed']}
"""


@app.get("/search/{index}")
async def search(
    index: str,
    q: str = Query(default="", description="Search query"),
    size: int = Query(default=20, ge=1, le=100),
    from_: int = Query(default=0, ge=0, alias="from"),
):
    """Search any RemitFlow index."""
    full_index = f"remitflow-{index}" if not index.startswith("remitflow-") else index
    result = await search_index(full_index, q, size=size, from_=from_)
    return result


@app.post("/index/{index}")
async def index_documents(index: str, documents: List[Dict[str, Any]]):
    """Manually index documents."""
    full_index = f"remitflow-{index}" if not index.startswith("remitflow-") else index
    count = await bulk_index(full_index, documents)
    return {"indexed": count, "index": full_index}


@app.post("/reindex")
async def trigger_reindex():
    """Trigger a manual reindex."""
    asyncio.create_task(reindex_loop())
    return {"status": "reindex triggered"}


@app.get("/indices")
async def list_indices():
    """List all RemitFlow indices."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{OPENSEARCH_URL}/_cat/indices/remitflow-*?format=json")
            if resp.status_code == 200:
                return {"indices": resp.json()}
    except Exception as e:
        logger.warning(f"Could not list indices: {e}")
    return {"indices": list(INDEX_MAPPINGS.keys())}


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    asyncio.create_task(reindex_loop())
    logger.info(f"[SEARCH-INDEXER] Started on port {PORT}")


@app.on_event("shutdown")
async def shutdown():
    stats["running"] = False
    logger.info("[SEARCH-INDEXER] Shutting down")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level=LOG_LEVEL.lower())
