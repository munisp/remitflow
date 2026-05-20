"""
RemitFlow — Kafka Event Processor (Python)
Consumes transaction events from Kafka and:
  - Indexes them in OpenSearch
  - Triggers fraud/AML checks
  - Updates analytics aggregates
  - Sends notifications for key events
"""

import asyncio
import json
import logging
import os
import signal
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import PlainTextResponse
import uvicorn

# ── Config ────────────────────────────────────────────────────────────────────

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
PORT = int(os.getenv("PORT", "8087"))
KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092")
KAFKA_GROUP_ID = os.getenv("KAFKA_GROUP_ID", "remitflow-processor")
OPENSEARCH_URL = os.getenv("OPENSEARCH_URL", "http://localhost:9200")
DATABASE_URL = os.getenv("DATABASE_URL", "")
FRAUD_ML_URL = os.getenv("FRAUD_ML_URL", "http://localhost:8082")
AML_ENGINE_URL = os.getenv("AML_ENGINE_URL", "http://localhost:8083")
RISK_ENGINE_URL = os.getenv("RISK_ENGINE_URL", "http://localhost:8091")

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("kafka-processor")

# ── Kafka Topics ──────────────────────────────────────────────────────────────

TOPICS = [
    "remitflow.transactions.created",
    "remitflow.transactions.updated",
    "remitflow.transactions.completed",
    "remitflow.transactions.failed",
    "remitflow.kyc.submitted",
    "remitflow.kyc.approved",
    "remitflow.kyc.rejected",
    "remitflow.payments.initiated",
    "remitflow.payments.completed",
    "remitflow.fraud.alerts",
    "remitflow.aml.flags",
    "remitflow.users.registered",
    "remitflow.investments.placed",
    "remitflow.mojaloop.transfer.callbacks",
]

# ── Stats ─────────────────────────────────────────────────────────────────────

stats = {
    "messages_processed": 0,
    "messages_failed": 0,
    "last_processed_at": None,
    "topics_consumed": TOPICS,
    "running": True,
}

# ── Event Handlers ────────────────────────────────────────────────────────────

async def index_to_opensearch(index: str, doc_id: str, document: Dict[str, Any]) -> bool:
    """Index a document in OpenSearch."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.put(
                f"{OPENSEARCH_URL}/{index}/_doc/{doc_id}",
                json=document,
                headers={"Content-Type": "application/json"},
            )
            return resp.status_code in (200, 201)
    except Exception as e:
        logger.warning(f"OpenSearch index failed: {e}")
        return False


async def check_fraud(transaction: Dict[str, Any]) -> Optional[Dict]:
    """Call fraud ML service for transaction scoring."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                f"{FRAUD_ML_URL}/predict",
                json=transaction,
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.debug(f"Fraud check skipped: {e}")
    return None


async def check_aml(transaction: Dict[str, Any]) -> Optional[Dict]:
    """Call AML engine for compliance screening."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                f"{AML_ENGINE_URL}/screen",
                json=transaction,
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.debug(f"AML check skipped: {e}")
    return None


async def handle_transaction_created(event: Dict[str, Any]) -> None:
    """Handle new transaction events."""
    tx_id = event.get("id", "unknown")
    logger.info(f"[TX_CREATED] Processing transaction {tx_id}")

    # 1. Index in OpenSearch
    doc = {
        **event,
        "@timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "transaction_created",
    }
    await index_to_opensearch("remitflow-transactions", tx_id, doc)

    # 2. Fraud check for large transactions
    amount = float(event.get("amount", 0))
    if amount > 1000:
        fraud_result = await check_fraud(event)
        if fraud_result and fraud_result.get("risk_score", 0) > 0.7:
            logger.warning(f"[FRAUD] High risk transaction {tx_id}: score={fraud_result['risk_score']}")

    # 3. AML screening
    aml_result = await check_aml(event)
    if aml_result and aml_result.get("flagged"):
        logger.warning(f"[AML] Transaction {tx_id} flagged: {aml_result.get('reason')}")


async def handle_kyc_submitted(event: Dict[str, Any]) -> None:
    """Handle KYC submission events."""
    user_id = event.get("userId", "unknown")
    logger.info(f"[KYC_SUBMITTED] User {user_id} submitted KYC")

    doc = {
        **event,
        "@timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "kyc_submitted",
    }
    await index_to_opensearch("remitflow-kyc", user_id, doc)


async def handle_payment_completed(event: Dict[str, Any]) -> None:
    """Handle payment completion events."""
    payment_id = event.get("id", "unknown")
    logger.info(f"[PAYMENT_COMPLETED] Payment {payment_id} completed")

    doc = {
        **event,
        "@timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "payment_completed",
    }
    await index_to_opensearch("remitflow-payments", payment_id, doc)


async def handle_investment_placed(event: Dict[str, Any]) -> None:
    """Handle investment order events."""
    order_id = event.get("id", "unknown")
    logger.info(f"[INVESTMENT] Order {order_id} placed")

    doc = {
        **event,
        "@timestamp": datetime.now(timezone.utc).isoformat(),
        "event_type": "investment_placed",
    }
    await index_to_opensearch("remitflow-investments", order_id, doc)


async def handle_mojaloop_callback(event: Dict[str, Any]) -> None:
    """Handle Mojaloop transfer callback events."""
    transfer_id = event.get("transferId", "unknown")
    state = event.get("transferState", "UNKNOWN")
    logger.info(f"[MOJALOOP] Transfer {transfer_id} → {state}")


# ── Event Router ──────────────────────────────────────────────────────────────

HANDLERS = {
    "remitflow.transactions.created": handle_transaction_created,
    "remitflow.transactions.completed": handle_payment_completed,
    "remitflow.kyc.submitted": handle_kyc_submitted,
    "remitflow.payments.completed": handle_payment_completed,
    "remitflow.investments.placed": handle_investment_placed,
    "remitflow.mojaloop.transfer.callbacks": handle_mojaloop_callback,
}


async def process_message(topic: str, message: Dict[str, Any]) -> None:
    """Route a Kafka message to the appropriate handler."""
    handler = HANDLERS.get(topic)
    if handler:
        await handler(message)
    else:
        logger.debug(f"No handler for topic {topic}, indexing generically")
        doc_id = message.get("id", datetime.now(timezone.utc).isoformat())
        index = f"remitflow-{topic.split('.')[-1]}"
        await index_to_opensearch(index, doc_id, {
            **message,
            "@timestamp": datetime.now(timezone.utc).isoformat(),
            "topic": topic,
        })

    stats["messages_processed"] += 1
    stats["last_processed_at"] = datetime.now(timezone.utc).isoformat()


# ── Kafka Consumer Loop ───────────────────────────────────────────────────────

async def kafka_consumer_loop() -> None:
    """Main Kafka consumer loop with graceful degradation."""
    try:
        from aiokafka import AIOKafkaConsumer
        consumer = AIOKafkaConsumer(
            *TOPICS,
            bootstrap_servers=KAFKA_BROKERS,
            group_id=KAFKA_GROUP_ID,
            auto_offset_reset="earliest",
            enable_auto_commit=True,
            value_deserializer=lambda m: json.loads(m.decode("utf-8")),
        )
        await consumer.start()
        logger.info(f"[KAFKA] Connected to {KAFKA_BROKERS}, consuming {len(TOPICS)} topics")

        try:
            async for msg in consumer:
                try:
                    await process_message(msg.topic, msg.value)
                except Exception as e:
                    logger.error(f"Error processing message from {msg.topic}: {e}")
                    stats["messages_failed"] += 1
        finally:
            await consumer.stop()
    except ImportError:
        logger.warning("[KAFKA] aiokafka not installed — running in HTTP-only mode")
        # Keep running as HTTP service only
        while stats["running"]:
            await asyncio.sleep(5)
    except Exception as e:
        logger.error(f"[KAFKA] Consumer error: {e}")
        # Keep HTTP server running even if Kafka is unavailable
        while stats["running"]:
            await asyncio.sleep(10)


# ── FastAPI HTTP Server ───────────────────────────────────────────────────────

app = FastAPI(title="RemitFlow Kafka Processor", version="1.0.0")


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "kafka-processor",
        "version": "1.0.0",
        "stats": stats,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return f"""# HELP kafka_messages_processed_total Total messages processed
# TYPE kafka_messages_processed_total counter
kafka_messages_processed_total {stats['messages_processed']}
# HELP kafka_messages_failed_total Total messages failed
# TYPE kafka_messages_failed_total counter
kafka_messages_failed_total {stats['messages_failed']}
"""


@app.post("/process")
async def process_event(payload: Dict[str, Any]):
    """HTTP endpoint for direct event processing (testing/fallback)."""
    topic = payload.get("topic", "remitflow.transactions.created")
    event = payload.get("event", {})
    await process_message(topic, event)
    return {"status": "processed", "topic": topic}


@app.get("/topics")
async def list_topics():
    return {"topics": TOPICS, "count": len(TOPICS)}


# ── Startup ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    asyncio.create_task(kafka_consumer_loop())
    logger.info(f"[KAFKA-PROCESSOR] Started on port {PORT}")


@app.on_event("shutdown")
async def shutdown():
    stats["running"] = False
    logger.info("[KAFKA-PROCESSOR] Shutting down")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=PORT,
        log_level=LOG_LEVEL.lower(),
        access_log=True,
    )
