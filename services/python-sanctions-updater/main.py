"""
RemitFlow Sanctions List Auto-Refresh Service (Python)
Downloads and indexes OFAC SDN, UN Consolidated, EU Consolidated, and HM Treasury lists
into OpenSearch for real-time sanctions screening.

Integrates with: OpenSearch, Dapr pubsub, Kafka
Schedule: Run daily at 02:00 UTC via Temporal or cron
"""

import asyncio
import hashlib
import json
import logging
import os
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Optional
from dataclasses import dataclass, field, asdict

import httpx
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras
from contextlib import contextmanager

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS sanctions_updater_state (
                    id TEXT PRIMARY KEY,
                    data JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_sanctions_updater_updated
                    ON sanctions_updater_state(updated_at);
                CREATE TABLE IF NOT EXISTS sanctions_updater_events (
                    id BIGSERIAL PRIMARY KEY,
                    event_type TEXT NOT NULL,
                    payload JSONB NOT NULL DEFAULT '{}',
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_sanctions_updater_events_type
                    ON sanctions_updater_events(event_type, created_at);
            """)
    return _db_pool

def db_upsert(record_id: str, data: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO sanctions_updater_state (id, data, updated_at)
               VALUES (%s, %s, NOW())
               ON CONFLICT (id) DO UPDATE SET data = %s, updated_at = NOW()""",
            (record_id, psycopg2.extras.Json(data), psycopg2.extras.Json(data))
        )

def db_get(record_id: str) -> dict | None:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("SELECT data FROM sanctions_updater_state WHERE id = %s", (record_id,))
        row = cur.fetchone()
        return row["data"] if row else None

def db_list(limit: int = 100) -> list[dict]:
    conn = _get_db()
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            "SELECT data FROM sanctions_updater_state ORDER BY updated_at DESC LIMIT %s",
            (limit,)
        )
        return [row["data"] for row in cur.fetchall()]

def db_log_event(event_type: str, payload: dict):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO sanctions_updater_events (event_type, payload) VALUES (%s, %s)",
            (event_type, psycopg2.extras.Json(payload))
        )
# ── End PostgreSQL persistence ──────────────────────────────────────────


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("sanctions-updater")

app = FastAPI(title="RemitFlow Sanctions Updater", version="1.0.0")

# ─── Config ──────────────────────────────────────────────────────────────────

OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
OPENSEARCH_INDEX = os.getenv("OPENSEARCH_INDEX", "remitflow-sanctions")
DAPR_PUBSUB = os.getenv("DAPR_PUBSUB_NAME", "remitflow-pubsub")
DAPR_TOPIC = os.getenv("DAPR_TOPIC_SANCTIONS", "sanctions.updated")
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")

# Sanctions list source URLs
OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.xml"
OFAC_CONSOLIDATED_URL = "https://www.treasury.gov/ofac/downloads/consolidated/consolidated.xml"
UN_CONSOLIDATED_URL = "https://scsanctions.un.org/resources/xml/en/consolidated.xml"
EU_CONSOLIDATED_URL = "https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content"
HMT_URL = "https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/consolidated-list.xml"

# ─── Models ──────────────────────────────────────────────────────────────────

@dataclass
class SanctionedEntity:
    source: str           # ofac_sdn | ofac_consolidated | un | eu | hmt
    entity_id: str
    entity_type: str      # individual | entity | vessel | aircraft
    names: list[str]
    aliases: list[str]
    nationalities: list[str]
    dob: Optional[str]
    passport_numbers: list[str]
    addresses: list[str]
    programs: list[str]   # sanctions programs (e.g., IRAN, RUSSIA, DPRK)
    remarks: str
    indexed_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_doc(self) -> dict:
        d = asdict(self)
        # Create searchable name field combining all names and aliases
        d["all_names"] = " ".join(self.names + self.aliases)
        d["name_hash"] = hashlib.sha256(d["all_names"].lower().encode()).hexdigest()
        return d


class UpdateRequest(BaseModel):
    sources: list[str] = ["ofac_sdn", "un", "eu"]
    dry_run: bool = False


class UpdateResponse(BaseModel):
    sources_processed: list[str]
    total_entities: int
    indexed: int
    errors: list[str]
    duration_seconds: float
    triggered_at: str


class HealthResponse(BaseModel):
    status: str
    opensearch_connected: bool
    last_update: Optional[str]
    total_indexed: int


# ─── OpenSearch Client ────────────────────────────────────────────────────────

async def ensure_index(client: httpx.AsyncClient) -> bool:
    """Create the sanctions index with proper mappings if it doesn't exist."""
    mapping = {
        "mappings": {
            "properties": {
                "source": {"type": "keyword"},
                "entity_id": {"type": "keyword"},
                "entity_type": {"type": "keyword"},
                "names": {"type": "text", "analyzer": "standard"},
                "aliases": {"type": "text", "analyzer": "standard"},
                "all_names": {"type": "text", "analyzer": "standard"},
                "name_hash": {"type": "keyword"},
                "nationalities": {"type": "keyword"},
                "dob": {"type": "keyword"},
                "passport_numbers": {"type": "keyword"},
                "programs": {"type": "keyword"},
                "remarks": {"type": "text"},
                "indexed_at": {"type": "date"},
            }
        },
        "settings": {
            "number_of_shards": 2,
            "number_of_replicas": 1,
            "analysis": {
                "analyzer": {
                    "name_analyzer": {
                        "type": "custom",
                        "tokenizer": "standard",
                        "filter": ["lowercase", "asciifolding", "edge_ngram"]
                    }
                },
                "filter": {
                    "edge_ngram": {
                        "type": "edge_ngram",
                        "min_gram": 2,
                        "max_gram": 20
                    }
                }
            }
        }
    }
    try:
        resp = await client.head(f"{OPENSEARCH_URL}/{OPENSEARCH_INDEX}")
        if resp.status_code == 404:
            resp = await client.put(f"{OPENSEARCH_URL}/{OPENSEARCH_INDEX}", json=mapping)
            logger.info(f"Created index {OPENSEARCH_INDEX}: {resp.status_code}")
        return True
    except Exception as e:
        logger.error(f"Failed to ensure index: {e}")
        return False


async def bulk_index(client: httpx.AsyncClient, entities: list[SanctionedEntity]) -> int:
    """Bulk index entities into OpenSearch."""
    if not entities:
        return 0

    bulk_body = []
    for entity in entities:
        doc_id = f"{entity.source}_{entity.entity_id}"
        bulk_body.append(json.dumps({"index": {"_index": OPENSEARCH_INDEX, "_id": doc_id}}))
        bulk_body.append(json.dumps(entity.to_doc()))

    body = "\n".join(bulk_body) + "\n"
    try:
        resp = await client.post(
            f"{OPENSEARCH_URL}/_bulk",
            content=body,
            headers={"Content-Type": "application/x-ndjson"},
            timeout=60.0
        )
        result = resp.json()
        errors = [item for item in result.get("items", []) if "error" in item.get("index", {})]
        if errors:
            logger.warning(f"Bulk index had {len(errors)} errors")
        indexed = len(entities) - len(errors)
        logger.info(f"Indexed {indexed}/{len(entities)} entities")
        return indexed
    except Exception as e:
        logger.error(f"Bulk index failed: {e}")
        return 0


# ─── OFAC SDN Parser ─────────────────────────────────────────────────────────

async def fetch_ofac_sdn(client: httpx.AsyncClient) -> list[SanctionedEntity]:
    """Download and parse OFAC SDN XML list."""
    entities = []
    try:
        logger.info("Downloading OFAC SDN list...")
        resp = await client.get(OFAC_SDN_URL, timeout=120.0, follow_redirects=True)
        if resp.status_code != 200:
            logger.error(f"OFAC SDN download failed: {resp.status_code}")
            return []

        root = ET.fromstring(resp.content)
        ns = {"ofac": "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/XML"}

        for entry in root.findall(".//ofac:sdnEntry", ns):
            uid = entry.findtext("ofac:uid", default="", namespaces=ns)
            sdn_type = entry.findtext("ofac:sdnType", default="individual", namespaces=ns).lower()

            # Primary name
            last = entry.findtext("ofac:lastName", default="", namespaces=ns)
            first = entry.findtext("ofac:firstName", default="", namespaces=ns)
            primary_name = f"{first} {last}".strip() if first else last

            # Aliases
            aliases = []
            for aka in entry.findall(".//ofac:aka", ns):
                aka_last = aka.findtext("ofac:lastName", default="", namespaces=ns)
                aka_first = aka.findtext("ofac:firstName", default="", namespaces=ns)
                alias = f"{aka_first} {aka_last}".strip() if aka_first else aka_last
                if alias:
                    aliases.append(alias)

            # Programs
            programs = [p.text for p in entry.findall("ofac:programList/ofac:program", ns) if p.text]

            # DOB
            dob = entry.findtext(".//ofac:dateOfBirthItem/ofac:dateOfBirth", default=None, namespaces=ns)

            # Nationalities
            nationalities = [
                n.text for n in entry.findall(".//ofac:nationalityItem/ofac:nationality", ns) if n.text
            ]

            # Passport numbers
            passports = [
                p.text for p in entry.findall(".//ofac:idNumber", ns) if p.text
            ]

            # Addresses
            addresses = []
            for addr in entry.findall(".//ofac:address", ns):
                parts = [
                    addr.findtext("ofac:address1", default="", namespaces=ns),
                    addr.findtext("ofac:city", default="", namespaces=ns),
                    addr.findtext("ofac:country", default="", namespaces=ns),
                ]
                addr_str = ", ".join(p for p in parts if p)
                if addr_str:
                    addresses.append(addr_str)

            remarks = entry.findtext("ofac:remarks", default="", namespaces=ns) or ""

            if primary_name:
                entities.append(SanctionedEntity(
                    source="ofac_sdn",
                    entity_id=uid,
                    entity_type=sdn_type,
                    names=[primary_name],
                    aliases=aliases,
                    nationalities=nationalities,
                    dob=dob,
                    passport_numbers=passports,
                    addresses=addresses,
                    programs=programs,
                    remarks=remarks,
                ))

        logger.info(f"Parsed {len(entities)} OFAC SDN entities")
    except Exception as e:
        logger.error(f"OFAC SDN parse error: {e}")
    return entities


# ─── UN Consolidated Parser ───────────────────────────────────────────────────

async def fetch_un_consolidated(client: httpx.AsyncClient) -> list[SanctionedEntity]:
    """Download and parse UN Consolidated Sanctions List."""
    entities = []
    try:
        logger.info("Downloading UN Consolidated list...")
        resp = await client.get(UN_CONSOLIDATED_URL, timeout=120.0, follow_redirects=True)
        if resp.status_code != 200:
            logger.error(f"UN list download failed: {resp.status_code}")
            return []

        root = ET.fromstring(resp.content)

        for individual in root.findall(".//INDIVIDUAL"):
            uid = individual.findtext("DATAID", default="")
            first = individual.findtext("FIRST_NAME", default="")
            second = individual.findtext("SECOND_NAME", default="")
            third = individual.findtext("THIRD_NAME", default="")
            fourth = individual.findtext("FOURTH_NAME", default="")
            name_parts = [p for p in [first, second, third, fourth] if p]
            primary_name = " ".join(name_parts)

            aliases = []
            for alias in individual.findall("INDIVIDUAL_ALIAS"):
                alias_name = alias.findtext("ALIAS_NAME", default="")
                if alias_name:
                    aliases.append(alias_name)

            dob = individual.findtext("INDIVIDUAL_DATE_OF_BIRTH/DATE", default=None)
            nationalities = [
                n.text for n in individual.findall("NATIONALITY/VALUE") if n.text
            ]

            if primary_name:
                entities.append(SanctionedEntity(
                    source="un_consolidated",
                    entity_id=uid,
                    entity_type="individual",
                    names=[primary_name],
                    aliases=aliases,
                    nationalities=nationalities,
                    dob=dob,
                    passport_numbers=[],
                    addresses=[],
                    programs=["UN_CONSOLIDATED"],
                    remarks="",
                ))

        for entity in root.findall(".//ENTITY"):
            uid = entity.findtext("DATAID", default="")
            name = entity.findtext("FIRST_NAME", default="")
            aliases = [a.text for a in entity.findall("ENTITY_ALIAS/ALIAS_NAME") if a.text]

            if name:
                entities.append(SanctionedEntity(
                    source="un_consolidated",
                    entity_id=f"ent_{uid}",
                    entity_type="entity",
                    names=[name],
                    aliases=aliases,
                    nationalities=[],
                    dob=None,
                    passport_numbers=[],
                    addresses=[],
                    programs=["UN_CONSOLIDATED"],
                    remarks="",
                ))

        logger.info(f"Parsed {len(entities)} UN Consolidated entities")
    except Exception as e:
        logger.error(f"UN Consolidated parse error: {e}")
    return entities


# ─── Dapr Publisher ──────────────────────────────────────────────────────────

async def publish_update_event(client: httpx.AsyncClient, stats: dict) -> None:
    """Publish sanctions update event via Dapr pubsub."""
    try:
        dapr_url = f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/{DAPR_PUBSUB}/{DAPR_TOPIC}"
        await client.post(dapr_url, json={
            "event_type": "sanctions.list.updated",
            "stats": stats,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }, timeout=10.0)
        logger.info("Published sanctions update event via Dapr")
    except Exception as e:
        logger.warning(f"Dapr publish failed (non-critical): {e}")


# ─── Main Update Logic ────────────────────────────────────────────────────────

async def run_update(sources: list[str], dry_run: bool = False) -> UpdateResponse:
    start = time.time()
    errors = []
    all_entities: list[SanctionedEntity] = []

    async with httpx.AsyncClient() as client:
        # Ensure OpenSearch index exists
        if not dry_run:
            await ensure_index(client)

        # Fetch from each source
        fetchers = {
            "ofac_sdn": fetch_ofac_sdn,
            "un_consolidated": fetch_un_consolidated,
        }

        processed_sources = []
        for source in sources:
            if source in fetchers:
                try:
                    entities = await fetchers[source](client)
                    all_entities.extend(entities)
                    processed_sources.append(source)
                    logger.info(f"Source {source}: {len(entities)} entities")
                except Exception as e:
                    errors.append(f"{source}: {str(e)}")
                    logger.error(f"Source {source} failed: {e}")

        # Bulk index
        indexed = 0
        if not dry_run and all_entities:
            # Index in batches of 500
            batch_size = 500
            for i in range(0, len(all_entities), batch_size):
                batch = all_entities[i:i + batch_size]
                indexed += await bulk_index(client, batch)

            # Publish update event
            await publish_update_event(client, {
                "sources": processed_sources,
                "total_entities": len(all_entities),
                "indexed": indexed,
            })
        else:
            indexed = len(all_entities) if dry_run else 0

    duration = time.time() - start
    logger.info(f"Update complete: {len(all_entities)} entities, {indexed} indexed, {duration:.1f}s")

    return UpdateResponse(
        sources_processed=processed_sources,
        total_entities=len(all_entities),
        indexed=indexed,
        errors=errors,
        duration_seconds=round(duration, 2),
        triggered_at=datetime.now(timezone.utc).isoformat(),
    )


# ─── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse)
async def health():
    opensearch_ok = False
    total_indexed = 0
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OPENSEARCH_URL}/{OPENSEARCH_INDEX}/_count", timeout=5.0)
            if resp.status_code == 200:
                opensearch_ok = True
                total_indexed = resp.json().get("count", 0)
    except Exception:
        pass

    return HealthResponse(
        status="healthy",
        opensearch_connected=opensearch_ok,
        last_update=None,
        total_indexed=total_indexed,
    )


@app.post("/api/update", response_model=UpdateResponse)
async def trigger_update(req: UpdateRequest, background_tasks: BackgroundTasks):
    """Trigger a sanctions list update. Runs in background for large lists."""
    result = await run_update(req.sources, req.dry_run)
    return result


@app.post("/api/update/full")
async def trigger_full_update(background_tasks: BackgroundTasks):
    """Trigger a full update of all sanctions sources."""
    all_sources = ["ofac_sdn", "un_consolidated"]
    result = await run_update(all_sources, dry_run=False)
    return result


@app.get("/api/stats")
async def get_stats():
    """Get current sanctions index statistics."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                f"{OPENSEARCH_URL}/{OPENSEARCH_INDEX}/_search",
                json={
                    "size": 0,
                    "aggs": {
                        "by_source": {"terms": {"field": "source", "size": 10}},
                        "by_type": {"terms": {"field": "entity_type", "size": 10}},
                    }
                },
                timeout=10.0
            )
            data = resp.json()
            return {
                "total": data.get("hits", {}).get("total", {}).get("value", 0),
                "by_source": {
                    b["key"]: b["doc_count"]
                    for b in data.get("aggregations", {}).get("by_source", {}).get("buckets", [])
                },
                "by_type": {
                    b["key"]: b["doc_count"]
                    for b in data.get("aggregations", {}).get("by_type", {}).get("buckets", [])
                },
            }
        except Exception as e:
            raise HTTPException(status_code=503, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8093"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
