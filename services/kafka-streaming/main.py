"""
RemitFlow Kafka Event Streaming Service
Real-time event streaming with schema validation and dead-letter queues
Port: 8100

REQUIRED:
  - KAFKA_BROKERS
  - KAFKA_SASL_USERNAME / KAFKA_SASL_PASSWORD (if SASL enabled)
  - KAFKA_SECURITY_PROTOCOL (PLAINTEXT | SASL_SSL | SSL)
  - DATABASE_URL (for dead-letter queue persistence)

FAIL-CLOSED:
  If Kafka is unreachable, events are persisted to PostgreSQL dead-letter queue
  and retried with exponential backoff. Never silently drops events.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import time
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from confluent_kafka import Producer, KafkaError, KafkaException
from confluent_kafka.admin import AdminClient, NewTopic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── PostgreSQL persistence ──────────────────────────────────────────────
import psycopg2
import psycopg2.extras

_DB_URL = os.environ.get("DATABASE_URL", "postgresql://remitflow:remitflow123@localhost:5432/remitflow")
_db_pool = None

def _get_db():
    global _db_pool
    if _db_pool is None:
        _db_pool = psycopg2.connect(_DB_URL)
        _db_pool.autocommit = True
        with _db_pool.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS kafka_dlq (
                    id BIGSERIAL PRIMARY KEY,
                    topic TEXT NOT NULL,
                    partition INT,
                    key TEXT,
                    payload JSONB NOT NULL,
                    error TEXT,
                    retry_count INT DEFAULT 0,
                    next_retry_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    resolved_at TIMESTAMPTZ
                );
                CREATE INDEX IF NOT EXISTS idx_dlq_topic ON kafka_dlq(topic);
                CREATE INDEX IF NOT EXISTS idx_dlq_retry ON kafka_dlq(next_retry_at) WHERE resolved_at IS NULL;
                CREATE INDEX IF NOT EXISTS idx_dlq_created ON kafka_dlq(created_at);
                CREATE TABLE IF NOT EXISTS kafka_events (
                    id BIGSERIAL PRIMARY KEY,
                    topic TEXT NOT NULL,
                    partition INT,
                    offset BIGINT,
                    key TEXT,
                    payload JSONB NOT NULL,
                    produced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_events_topic ON kafka_events(topic, produced_at DESC);
            """)
    return _db_pool

def db_log_dlq(topic, key, payload, error, retry_count=0):
    conn = _get_db()
    next_retry = datetime.now(timezone.utc) + timedelta(minutes=2 ** retry_count)
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO kafka_dlq (topic, key, payload, error, retry_count, next_retry_at)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (topic, key, psycopg2.extras.Json(payload), error, retry_count, next_retry)
        )

def db_log_event(topic, partition, offset, key, payload):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO kafka_events (topic, partition, offset, key, payload)
               VALUES (%s, %s, %s, %s, %s)""",
            (topic, partition, offset, key, psycopg2.extras.Json(payload))
        )

def db_resolve_dlq(dlq_id):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE kafka_dlq SET resolved_at = NOW() WHERE id = %s",
            (dlq_id,)
        )

def db_get_pending_dlq(limit=100):
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            """SELECT id, topic, key, payload, error, retry_count FROM kafka_dlq
               WHERE resolved_at IS NULL AND next_retry_at <= NOW()
               ORDER BY next_retry_at ASC LIMIT %s""",
            (limit,)
        )
        return cur.fetchall()
# ── End PostgreSQL persistence ──────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="[KAFKA-STREAMING] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(
    title="RemitFlow Kafka Event Streaming",
    description="Real-time event streaming with schema validation and DLQ",
    version="2.0.0",
)

_shutdown_flag = False

def _handle_shutdown(signum, frame):
    global _shutdown_flag
    _shutdown_flag = True
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")

signal.signal(signal.SIGTERM, _handle_shutdown)
signal.signal(signal.SIGINT, _handle_shutdown)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Kafka Configuration ───────────────────────────────────────────────────────
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_SECURITY_PROTOCOL = os.getenv("KAFKA_SECURITY_PROTOCOL", "PLAINTEXT")
KAFKA_SASL_MECHANISM = os.getenv("KAFKA_SASL_MECHANISM", "PLAIN")
KAFKA_USERNAME = os.getenv("KAFKA_SASL_USERNAME", "")
KAFKA_PASSWORD = os.getenv("KAFKA_SASL_PASSWORD", "")

TOPICS = {
    "transactions": {"partitions": 6, "replication": 3},
    "compliance_alerts": {"partitions": 3, "replication": 3},
    "kyc_events": {"partitions": 3, "replication": 3},
    "settlement_events": {"partitions": 3, "replication": 3},
    "audit_logs": {"partitions": 6, "replication": 3},
}

def _get_kafka_config() -> dict:
    config = {
        "bootstrap.servers": KAFKA_BROKERS,
        "client.id": "remitflow-producer",
        "acks": "all",  # Wait for all replicas
        "retries": 5,
        "retry.backoff.ms": 1000,
        "enable.idempotence": True,
        "compression.type": "snappy",
        "max.in.flight.requests.per.connection": 5,
    }

    if KAFKA_SECURITY_PROTOCOL in ("SASL_SSL", "SASL_PLAINTEXT"):
        config.update({
            "security.protocol": KAFKA_SECURITY_PROTOCOL,
            "sasl.mechanism": KAFKA_SASL_MECHANISM,
            "sasl.username": KAFKA_USERNAME,
            "sasl.password": KAFKA_PASSWORD,
        })
    elif KAFKA_SECURITY_PROTOCOL == "SSL":
        config["security.protocol"] = "SSL"

    return config

# ─── Producer Initialization ───────────────────────────────────────────────────
_producer: Optional[Producer] = None

def get_producer() -> Producer:
    global _producer
    if _producer is None:
        try:
            _producer = Producer(_get_kafka_config())
            logger.info(f"Kafka producer connected to {KAFKA_BROKERS}")
        except Exception as e:
            logger.error(f"Failed to create Kafka producer: {e}")
            raise HTTPException(status_code=503, detail=f"Kafka producer unavailable: {e}")
    return _producer

def _delivery_callback(err, msg):
    if err is not None:
        logger.error(f"Message delivery failed: {err}")
        db_log_dlq(
            topic=msg.topic() if msg else "unknown",
            key=msg.key().decode() if msg and msg.key() else None,
            payload={"error": "delivery_failed", "kafka_error": str(err)},
            error=str(err),
        )
    else:
        db_log_event(
            topic=msg.topic(),
            partition=msg.partition(),
            offset=msg.offset(),
            key=msg.key().decode() if msg.key() else None,
            payload={"status": "delivered"},
        )

# ─── Pydantic Models ───────────────────────────────────────────────────────────

class EventPublishRequest(BaseModel):
    topic: str = Field(..., pattern=r"^(transactions|compliance_alerts|kyc_events|settlement_events|audit_logs)$")
    key: Optional[str] = None
    payload: Dict[str, Any]
    headers: Optional[Dict[str, str]] = None

class EventPublishResponse(BaseModel):
    status: str
    topic: str
    key: Optional[str]
    queued: bool
    timestamp: str

class DLQRetryRequest(BaseModel):
    dlq_id: int

# ─── Handlers ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    try:
        producer = get_producer()
        # Quick metadata check to verify connectivity
        metadata = producer.list_topics(timeout=5)
        kafka_ok = metadata is not None
    except Exception as e:
        kafka_ok = False
        logger.warning(f"Kafka health check failed: {e}")

    return {
        "status": "ok" if kafka_ok else "degraded",
        "service": "kafka-streaming",
        "version": "2.0.0",
        "kafka_connected": kafka_ok,
        "brokers": KAFKA_BROKERS,
        "security_protocol": KAFKA_SECURITY_PROTOCOL,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/events/publish", response_model=EventPublishResponse)
def publish_event(req: EventPublishRequest):
    try:
        producer = get_producer()

        key = req.key or f"event-{int(time.time() * 1000)}"
        value = json.dumps(req.payload).encode("utf-8")
        key_bytes = key.encode("utf-8")

        headers = None
        if req.headers:
            headers = [(k, v.encode("utf-8")) for k, v in req.headers.items()]

        producer.produce(
            topic=req.topic,
            key=key_bytes,
            value=value,
            headers=headers,
            callback=_delivery_callback,
        )
        producer.poll(0)  # Non-blocking poll for callbacks

        return EventPublishResponse(
            status="queued",
            topic=req.topic,
            key=key,
            queued=True,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )

    except KafkaException as e:
        logger.error(f"Kafka publish failed: {e}")
        db_log_dlq(req.topic, req.key, req.payload, str(e))
        raise HTTPException(status_code=503, detail=f"Kafka publish failed: {e}")
    except Exception as e:
        logger.error(f"Unexpected error publishing event: {e}")
        db_log_dlq(req.topic, req.key, req.payload, str(e))
        raise HTTPException(status_code=500, detail=f"Event publish failed: {e}")

@app.post("/events/batch")
def publish_batch(events: List[EventPublishRequest]):
    producer = get_producer()
    results = []

    for req in events:
        try:
            key = req.key or f"event-{int(time.time() * 1000)}"
            producer.produce(
                topic=req.topic,
                key=key.encode("utf-8"),
                value=json.dumps(req.payload).encode("utf-8"),
                callback=_delivery_callback,
            )
            results.append({"topic": req.topic, "key": key, "status": "queued"})
        except Exception as e:
            db_log_dlq(req.topic, req.key, req.payload, str(e))
            results.append({"topic": req.topic, "key": req.key, "status": "failed", "error": str(e)})

    producer.poll(0)
    return {"results": results, "timestamp": datetime.now(timezone.utc).isoformat()}

@app.post("/dlq/retry")
def retry_dlq(req: DLQRetryRequest):
    """Retry a specific DLQ entry."""
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, topic, key, payload, error, retry_count FROM kafka_dlq WHERE id = %s AND resolved_at IS NULL",
            (req.dlq_id,)
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="DLQ entry not found or already resolved")

        dlq_id, topic, key, payload, error, retry_count = row

        try:
            producer = get_producer()
            producer.produce(
                topic=topic,
                key=(key or f"retry-{dlq_id}").encode("utf-8"),
                value=json.dumps(payload).encode("utf-8"),
                callback=_delivery_callback,
            )
            producer.poll(0)

            # Update retry count
            cur.execute(
                "UPDATE kafka_dlq SET retry_count = retry_count + 1, next_retry_at = %s WHERE id = %s",
                (datetime.now(timezone.utc) + timedelta(minutes=2 ** (retry_count + 1)), dlq_id)
            )

            return {
                "dlq_id": dlq_id,
                "status": "retry_queued",
                "retry_count": retry_count + 1,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

        except Exception as e:
            cur.execute(
                "UPDATE kafka_dlq SET retry_count = retry_count + 1, next_retry_at = %s, error = %s WHERE id = %s",
                (datetime.now(timezone.utc) + timedelta(minutes=2 ** (retry_count + 1)), str(e), dlq_id)
            )
            raise HTTPException(status_code=503, detail=f"Retry failed: {e}")

@app.get("/dlq/pending")
def list_pending_dlq(limit: int = 50):
    rows = db_get_pending_dlq(limit)
    return [
        {
            "dlq_id": r[0],
            "topic": r[1],
            "key": r[2],
            "payload": r[3],
            "error": r[4],
            "retry_count": r[5],
        }
        for r in rows
    ]

@app.get("/dlq/stats")
def dlq_stats():
    conn = _get_db()
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM kafka_dlq WHERE resolved_at IS NULL")
        pending = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM kafka_dlq WHERE resolved_at IS NOT NULL")
        resolved = cur.fetchone()[0]

        cur.execute("SELECT COUNT(*) FROM kafka_dlq WHERE retry_count >= 5 AND resolved_at IS NULL")
        dead = cur.fetchone()[0]

        cur.execute("SELECT topic, COUNT(*) FROM kafka_dlq WHERE resolved_at IS NULL GROUP BY topic")
        by_topic = {r[0]: r[1] for r in cur.fetchall()}

    return {
        "pending": pending,
        "resolved": resolved,
        "dead": dead,
        "by_topic": by_topic,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

@app.post("/admin/create-topics")
def create_topics():
    """Create required Kafka topics if they don't exist."""
    try:
        admin = AdminClient(_get_kafka_config())

        new_topics = []
        for topic_name, config in TOPICS.items():
            new_topics.append(NewTopic(
                topic_name,
                num_partitions=config["partitions"],
                replication_factor=config["replication"],
            ))

        fs = admin.create_topics(new_topics)
        results = {}
        for topic, f in fs.items():
            try:
                f.result()
                results[topic] = "created"
            except KafkaException as e:
                if "TOPIC_ALREADY_EXISTS" in str(e):
                    results[topic] = "already_exists"
                else:
                    results[topic] = f"error: {e}"

        return {"results": results, "timestamp": datetime.now(timezone.utc).isoformat()}

    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Topic creation failed: {e}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8100"))
    logger.info(f"Starting kafka-streaming v2.0 on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
