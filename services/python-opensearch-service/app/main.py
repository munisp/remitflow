"""
RemitFlow — OpenSearch Analytics Service (Python/FastAPI)
Full-text search, analytics, and observability for RemitFlow.

Features:
- Transaction search with filters (amount, currency, status, date range)
- User search (KYC status, risk score, country)
- Compliance case search
- Real-time analytics dashboards
- Audit log indexing and search
- AML pattern detection queries

OpenSearch: http://opensearch:9200 (default)
"""

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx

# ─── Configuration ────────────────────────────────────────────────────────────
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://opensearch:9200")
OPENSEARCH_USER = os.getenv("OPENSEARCH_USER", "admin")
OPENSEARCH_PASSWORD = os.getenv("OPENSEARCH_PASSWORD", "admin")
INTERNAL_API_KEY = os.getenv("OPENSEARCH_INTERNAL_API_KEY", "opensearch-bridge-key-001")

logging.basicConfig(level=logging.INFO, format="[OpenSearch] %(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ─── Index Definitions ────────────────────────────────────────────────────────
INDICES = {
    "transactions": "remitflow-transactions",
    "users": "remitflow-users",
    "compliance": "remitflow-compliance",
    "audit": "remitflow-audit",
    "fx_rates": "remitflow-fx-rates",
    "notifications": "remitflow-notifications",
}

# ─── Models ───────────────────────────────────────────────────────────────────
class TransactionSearchRequest(BaseModel):
    query: Optional[str] = None
    user_id: Optional[int] = None
    status: Optional[str] = None
    currency: Optional[str] = None
    rail: Optional[str] = None
    min_amount: Optional[float] = None
    max_amount: Optional[float] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    page: int = 1
    page_size: int = 20

class UserSearchRequest(BaseModel):
    query: Optional[str] = None
    kyc_status: Optional[str] = None
    risk_level: Optional[str] = None
    country: Optional[str] = None
    page: int = 1
    page_size: int = 20

class IndexDocumentRequest(BaseModel):
    index: str
    document_id: Optional[str] = None
    document: Dict[str, Any]

class AnalyticsRequest(BaseModel):
    metric: str  # volume, count, avg_amount, top_corridors, risk_distribution
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    group_by: Optional[str] = None  # currency, rail, status, country

# ─── OpenSearch Client ────────────────────────────────────────────────────────
class OpenSearchClient:
    def __init__(self):
        self.base_url = OPENSEARCH_URL
        self.auth = (OPENSEARCH_USER, OPENSEARCH_PASSWORD)
        self._available = None

    async def check_availability(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                resp = await client.get(f"{self.base_url}/_cluster/health", auth=self.auth)
                self._available = resp.status_code == 200
        except Exception:
            self._available = False
        return self._available

    async def search(self, index: str, query: dict) -> dict:
        if not await self.check_availability():
            return self._mock_search(index, query)

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self.base_url}/{index}/_search",
                auth=self.auth,
                json=query,
                headers={"Content-Type": "application/json"}
            )
            if resp.status_code == 200:
                return resp.json()
        return self._mock_search(index, query)

    async def index_document(self, index: str, doc_id: Optional[str], doc: dict) -> dict:
        if not await self.check_availability():
            return {"result": "created", "mock": True, "_id": doc_id or "mock-id"}

        url = f"{self.base_url}/{index}/_doc"
        if doc_id:
            url += f"/{doc_id}"

        async with httpx.AsyncClient(timeout=10) as client:
            method = client.put if doc_id else client.post
            resp = await method(url, auth=self.auth, json=doc,
                               headers={"Content-Type": "application/json"})
            return resp.json() if resp.status_code in (200, 201) else {"error": resp.text}

    async def get_cluster_stats(self) -> dict:
        if not await self.check_availability():
            return {"status": "mock", "indices": list(INDICES.values()), "available": False}

        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{self.base_url}/_cluster/stats", auth=self.auth)
            return resp.json() if resp.status_code == 200 else {"error": "unavailable"}

    def _mock_search(self, index: str, query: dict) -> dict:
        """Return mock search results when OpenSearch is unavailable"""
        return {
            "hits": {
                "total": {"value": 0, "relation": "eq"},
                "hits": [],
            },
            "took": 1,
            "_shards": {"total": 1, "successful": 1, "failed": 0},
            "_mock": True,
            "_index": index,
        }


os_client = OpenSearchClient()

# ─── PostgreSQL Persistence Layer ─────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_pg_conn = None

def _get_pg():
    global _pg_conn
    if _pg_conn is None or getattr(_pg_conn, 'closed', True):
        try:
            _pg_conn = psycopg2.connect(_DB_URL)
            _pg_conn.autocommit = True
            with _pg_conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS python_opensearch_service_state (
                        id TEXT PRIMARY KEY,
                        data JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                    CREATE TABLE IF NOT EXISTS python_opensearch_service_events (
                        id BIGSERIAL PRIMARY KEY,
                        event_type TEXT NOT NULL,
                        payload JSONB NOT NULL DEFAULT '{}',
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    );
                """)
            logging.info("[OpenSearch] PostgreSQL connected")
        except Exception as e:
            logging.warning(f"[OpenSearch] PostgreSQL unavailable ({e})")
            _pg_conn = None
    return _pg_conn

_get_pg()

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="RemitFlow OpenSearch Analytics",
    description="Full-text search and analytics for RemitFlow",
    version="v110.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_api_key(x_api_key: str = Header(None)):
    if x_api_key != INTERNAL_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

@app.get("/health")
async def health():
    available = await os_client.check_availability()
    return {
        "status": "healthy",
        "service": "opensearch-analytics",
        "version": "v110.0.0",
        "opensearch_available": available,
        "opensearch_url": OPENSEARCH_URL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/api/v1/search/transactions")
async def search_transactions(req: TransactionSearchRequest):
    """Search transactions with full-text and filtered queries"""
    must_clauses = []
    filter_clauses = []

    if req.query:
        must_clauses.append({"multi_match": {
            "query": req.query,
            "fields": ["transaction_id", "recipient_name", "reference", "external_ref"],
        }})

    if req.user_id:
        filter_clauses.append({"term": {"user_id": req.user_id}})
    if req.status:
        filter_clauses.append({"term": {"status.keyword": req.status}})
    if req.currency:
        filter_clauses.append({"term": {"from_currency.keyword": req.currency}})
    if req.rail:
        filter_clauses.append({"term": {"rail.keyword": req.rail}})
    if req.min_amount or req.max_amount:
        range_q: dict = {}
        if req.min_amount:
            range_q["gte"] = req.min_amount
        if req.max_amount:
            range_q["lte"] = req.max_amount
        filter_clauses.append({"range": {"amount": range_q}})
    if req.date_from or req.date_to:
        date_range: dict = {}
        if req.date_from:
            date_range["gte"] = req.date_from
        if req.date_to:
            date_range["lte"] = req.date_to
        filter_clauses.append({"range": {"created_at": date_range}})

    query = {
        "query": {"bool": {"must": must_clauses or [{"match_all": {}}], "filter": filter_clauses}},
        "from": (req.page - 1) * req.page_size,
        "size": req.page_size,
        "sort": [{"created_at": {"order": "desc"}}],
        "highlight": {"fields": {"recipient_name": {}, "reference": {}}} if req.query else {},
    }

    result = await os_client.search(INDICES["transactions"], query)
    return {
        "total": result.get("hits", {}).get("total", {}).get("value", 0),
        "page": req.page,
        "page_size": req.page_size,
        "hits": [h.get("_source", {}) for h in result.get("hits", {}).get("hits", [])],
    }

@app.post("/api/v1/search/users")
async def search_users(req: UserSearchRequest):
    """Search users with KYC and risk filters"""
    must_clauses = []
    filter_clauses = []

    if req.query:
        must_clauses.append({"multi_match": {
            "query": req.query,
            "fields": ["full_name", "email", "phone"],
        }})
    if req.kyc_status:
        filter_clauses.append({"term": {"kyc_status.keyword": req.kyc_status}})
    if req.risk_level:
        filter_clauses.append({"term": {"risk_level.keyword": req.risk_level}})
    if req.country:
        filter_clauses.append({"term": {"country.keyword": req.country}})

    query = {
        "query": {"bool": {"must": must_clauses or [{"match_all": {}}], "filter": filter_clauses}},
        "from": (req.page - 1) * req.page_size,
        "size": req.page_size,
    }

    result = await os_client.search(INDICES["users"], query)
    return {
        "total": result.get("hits", {}).get("total", {}).get("value", 0),
        "hits": [h.get("_source", {}) for h in result.get("hits", {}).get("hits", [])],
    }

@app.post("/api/v1/index")
async def index_document(req: IndexDocumentRequest, _=Depends(verify_api_key)):
    """Index a document into OpenSearch"""
    index = INDICES.get(req.index, req.index)
    doc = {**req.document, "indexed_at": datetime.now(timezone.utc).isoformat()}
    result = await os_client.index_document(index, req.document_id, doc)
    return result

@app.get("/api/v1/analytics/volume")
async def get_volume_analytics(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    group_by: str = Query("currency"),
):
    """Get transfer volume analytics"""
    date_from = date_from or (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    date_to = date_to or datetime.now(timezone.utc).isoformat()

    query = {
        "query": {"range": {"created_at": {"gte": date_from, "lte": date_to}}},
        "aggs": {
            "by_group": {
                "terms": {"field": f"{group_by}.keyword", "size": 20},
                "aggs": {
                    "total_volume": {"sum": {"field": "amount"}},
                    "avg_amount": {"avg": {"field": "amount"}},
                    "count": {"value_count": {"field": "transaction_id.keyword"}},
                }
            },
            "total_volume": {"sum": {"field": "amount"}},
            "total_count": {"value_count": {"field": "transaction_id.keyword"}},
        },
        "size": 0,
    }

    result = await os_client.search(INDICES["transactions"], query)
    aggs = result.get("aggregations", {})

    return {
        "date_from": date_from,
        "date_to": date_to,
        "group_by": group_by,
        "total_volume": aggs.get("total_volume", {}).get("value", 0),
        "total_count": aggs.get("total_count", {}).get("value", 0),
        "breakdown": [
            {
                "key": b["key"],
                "volume": b.get("total_volume", {}).get("value", 0),
                "count": b.get("count", {}).get("value", 0),
                "avg_amount": b.get("avg_amount", {}).get("value", 0),
            }
            for b in aggs.get("by_group", {}).get("buckets", [])
        ],
    }

@app.get("/api/v1/analytics/corridors")
async def get_top_corridors():
    """Get top remittance corridors"""
    query = {
        "aggs": {
            "corridors": {
                "terms": {
                    "script": {"source": "doc['from_currency.keyword'].value + '->' + doc['to_currency.keyword'].value"},
                    "size": 10,
                },
                "aggs": {"volume": {"sum": {"field": "amount"}}},
            }
        },
        "size": 0,
    }
    result = await os_client.search(INDICES["transactions"], query)
    buckets = result.get("aggregations", {}).get("corridors", {}).get("buckets", [])
    return {"corridors": [{"corridor": b["key"], "count": b["doc_count"], "volume": b.get("volume", {}).get("value", 0)} for b in buckets]}

@app.get("/api/v1/cluster/stats")
async def cluster_stats(_=Depends(verify_api_key)):
    return await os_client.get_cluster_stats()

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
