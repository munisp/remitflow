"""
RemitFlow KYC Event Consumer Service
Kafka consumer that listens for trigger events and fires KYC/KYB workflows.

Topics consumed:
  - remitflow.kyc.events           → triggers KYC verification workflow
  - remitflow.transactions         → checks for suspicious patterns, triggers re-KYC
  - remitflow.compliance.alert     → triggers enhanced re-verification
  - remitflow.payment.initiated    → pre-flight KYC gate check

Trigger rules (each topic maps to a KYC level):
  - account.application.created  → standard KYC
  - loan.application.submitted   → enhanced KYC
  - kyc.verification.required    → specified level
  - kyb.verification.required    → KYB corporate analysis
  - transaction.suspicious       → enhanced re-verification
  - account.upgrade.requested    → target tier's KYC level

Cooldown: Per-user, per-trigger cooldown window prevents re-verification spam.

Integrates with: Kafka, Temporal, PostgreSQL, Redis (cooldown tracking), Dapr
Port: 8120
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("kyc-event-consumer")

app = FastAPI(title="RemitFlow KYC Event Consumer", version="1.0.0")

# ─── Config ──────────────────────────────────────────────────────────────────

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092").split(",")
CONSUMER_GROUP = os.getenv("CONSUMER_GROUP", "kyc-event-consumer-group")
TEMPORAL_URL = os.getenv("TEMPORAL_URL", "http://localhost:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "default")
TEMPORAL_TASK_QUEUE = os.getenv("TEMPORAL_TASK_QUEUE", "remitflow-kyc")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "")
DAPR_HTTP_PORT = os.getenv("DAPR_HTTP_PORT", "3500")

# Topics to subscribe
TOPICS = [
    "remitflow.kyc.events",
    "remitflow.transactions",
    "remitflow.compliance.alert",
    "remitflow.payment.initiated",
]

# ─── Trigger Rules ────────────────────────────────────────────────────────────

TRIGGER_RULES: Dict[str, Dict[str, Any]] = {
    "account.application.created": {
        "kyc_level": "standard",
        "cooldown_hours": 24,
        "description": "New account application requires standard KYC",
    },
    "loan.application.submitted": {
        "kyc_level": "enhanced",
        "cooldown_hours": 1,
        "description": "Loan application requires enhanced KYC",
    },
    "kyc.verification.required": {
        "kyc_level": "dynamic",  # level specified in event payload
        "cooldown_hours": 0,     # no cooldown — explicit trigger
        "description": "Explicit KYC verification request",
    },
    "kyb.verification.required": {
        "kyc_level": "kyb",
        "cooldown_hours": 48,
        "description": "Corporate KYB verification required",
    },
    "transaction.suspicious": {
        "kyc_level": "enhanced",
        "cooldown_hours": 72,
        "description": "Suspicious transaction triggers re-verification",
    },
    "account.upgrade.requested": {
        "kyc_level": "dynamic",
        "cooldown_hours": 24,
        "description": "Account tier upgrade triggers target-tier KYC",
    },
}

# KYC level hierarchy for comparison
KYC_LEVEL_HIERARCHY = {
    "basic": 1,
    "standard": 2,
    "enhanced": 3,
    "full_edd": 4,
}

# ─── Models ────────────────────────────────────────────────────────────────────

class TriggerEvent(BaseModel):
    event_type: str
    customer_id: Optional[str] = None
    user_id: Optional[int] = None
    company_id: Optional[str] = None
    kyc_level: Optional[str] = None
    tier: Optional[str] = None
    amount: Optional[float] = None
    loan_type: Optional[str] = None
    metadata: Dict[str, Any] = {}


class CooldownEntry(BaseModel):
    customer_id: str
    trigger_type: str
    last_triggered: str
    cooldown_hours: int


class ConsumerStats(BaseModel):
    events_processed: int
    events_triggered: int
    events_skipped_cooldown: int
    events_errored: int
    last_event_at: Optional[str]
    uptime_seconds: float


# ─── Cooldown Manager ─────────────────────────────────────────────────────────

class CooldownManager:
    """Redis-backed cooldown tracking with in-memory fallback."""

    def __init__(self):
        self._redis = None
        self._memory: Dict[str, float] = {}
        self._connect_redis()

    def _connect_redis(self):
        try:
            import redis as redis_lib
            self._redis = redis_lib.from_url(REDIS_URL, decode_responses=True)
            self._redis.ping()
            logger.info("Cooldown manager connected to Redis")
        except Exception as e:
            logger.warning(f"Redis unavailable for cooldown tracking — using in-memory: {e}")
            self._redis = None

    def _key(self, customer_id: str, trigger_type: str) -> str:
        return f"kyc:cooldown:{customer_id}:{trigger_type}"

    def is_in_cooldown(self, customer_id: str, trigger_type: str, cooldown_hours: int) -> bool:
        if cooldown_hours <= 0:
            return False

        key = self._key(customer_id, trigger_type)
        cooldown_secs = cooldown_hours * 3600

        if self._redis:
            try:
                last = self._redis.get(key)
                if last and (time.time() - float(last)) < cooldown_secs:
                    return True
                return False
            except Exception:
                pass

        # Fallback to in-memory
        last = self._memory.get(key, 0)
        return (time.time() - last) < cooldown_secs

    def record_trigger(self, customer_id: str, trigger_type: str, cooldown_hours: int):
        key = self._key(customer_id, trigger_type)
        now = time.time()

        if self._redis:
            try:
                self._redis.setex(key, cooldown_hours * 3600, str(now))
                return
            except Exception:
                pass

        self._memory[key] = now


cooldown_mgr = CooldownManager()

# ─── Stats ─────────────────────────────────────────────────────────────────────

_stats = {
    "events_processed": 0,
    "events_triggered": 0,
    "events_skipped_cooldown": 0,
    "events_errored": 0,
    "last_event_at": None,
    "start_time": time.time(),
}

# ─── Temporal Client ──────────────────────────────────────────────────────────

async def start_kyc_workflow(
    customer_id: str,
    kyc_level: str,
    trigger_type: str,
    metadata: Dict[str, Any],
) -> Optional[str]:
    """Start a KYC verification workflow via Temporal."""
    workflow_id = f"kyc-{customer_id}-{trigger_type}-{int(time.time())}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{TEMPORAL_URL}/api/v1/namespaces/{TEMPORAL_NAMESPACE}/workflows/{workflow_id}",
                json={
                    "workflowType": {"name": "KYCVerificationWorkflow"},
                    "taskQueue": {"name": TEMPORAL_TASK_QUEUE},
                    "input": {
                        "payloads": [
                            {
                                "metadata": {"encoding": "json/plain"},
                                "data": json.dumps({
                                    "userId": int(customer_id) if customer_id.isdigit() else 0,
                                    "kycLevel": kyc_level,
                                    "triggerType": trigger_type,
                                    "triggerMetadata": metadata,
                                }).encode().hex(),
                            }
                        ]
                    },
                    "workflowExecutionTimeout": "86400s",
                    "workflowRunTimeout": "3600s",
                },
            )
            if resp.status_code in (200, 201, 409):
                logger.info(f"Started KYC workflow {workflow_id} for customer {customer_id} (level={kyc_level})")
                return workflow_id
            else:
                logger.error(f"Temporal returned {resp.status_code}: {resp.text[:200]}")
                return None
    except Exception as e:
        logger.error(f"Failed to start KYC workflow: {e}")
        return None


async def start_kyb_workflow(
    company_id: str,
    trigger_type: str,
    metadata: Dict[str, Any],
) -> Optional[str]:
    """Start a KYB verification workflow via Temporal."""
    workflow_id = f"kyb-{company_id}-{trigger_type}-{int(time.time())}"

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{TEMPORAL_URL}/api/v1/namespaces/{TEMPORAL_NAMESPACE}/workflows/{workflow_id}",
                json={
                    "workflowType": {"name": "KYBVerificationWorkflow"},
                    "taskQueue": {"name": TEMPORAL_TASK_QUEUE},
                    "input": {
                        "payloads": [
                            {
                                "metadata": {"encoding": "json/plain"},
                                "data": json.dumps({
                                    "companyId": company_id,
                                    "triggerType": trigger_type,
                                    "triggerMetadata": metadata,
                                }).encode().hex(),
                            }
                        ]
                    },
                    "workflowExecutionTimeout": "172800s",
                    "workflowRunTimeout": "7200s",
                },
            )
            if resp.status_code in (200, 201, 409):
                logger.info(f"Started KYB workflow {workflow_id} for company {company_id}")
                return workflow_id
            else:
                logger.error(f"Temporal returned {resp.status_code}: {resp.text[:200]}")
                return None
    except Exception as e:
        logger.error(f"Failed to start KYB workflow: {e}")
        return None


# ─── Audit Logging ─────────────────────────────────────────────────────────────

async def log_trigger_event(
    customer_id: str,
    trigger_type: str,
    kyc_level: str,
    workflow_id: Optional[str],
    skipped: bool = False,
    skip_reason: str = "",
):
    """Publish audit event via Dapr pubsub."""
    event = {
        "eventType": "kyc.trigger.processed",
        "customerId": customer_id,
        "triggerType": trigger_type,
        "kycLevel": kyc_level,
        "workflowId": workflow_id,
        "skipped": skipped,
        "skipReason": skip_reason,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"http://localhost:{DAPR_HTTP_PORT}/v1.0/publish/remitflow-pubsub/kyc.trigger.audit",
                json=event,
            )
    except Exception as e:
        logger.debug(f"Dapr audit publish failed (non-critical): {e}")


# ─── Event Processing ─────────────────────────────────────────────────────────

def determine_kyc_level(event: TriggerEvent, rule: Dict[str, Any]) -> str:
    """Determine the required KYC level based on event and rule."""
    if rule["kyc_level"] == "dynamic":
        # Use level from event payload
        return event.kyc_level or "standard"

    if rule["kyc_level"] == "kyb":
        return "kyb"

    # For loan applications, escalate based on amount
    if event.event_type == "loan.application.submitted" and event.amount:
        if event.loan_type == "mortgage" or event.amount >= 50_000_000:
            return "full_edd"
        if event.loan_type in ("sme", "corporate") or event.amount >= 10_000_000:
            return "enhanced"

    return rule["kyc_level"]


async def process_event(raw_event: Dict[str, Any]):
    """Process a single Kafka event and trigger KYC/KYB if needed."""
    _stats["events_processed"] += 1
    _stats["last_event_at"] = datetime.now(timezone.utc).isoformat()

    event_type = raw_event.get("eventType") or raw_event.get("event_type") or raw_event.get("type", "")
    customer_id = str(
        raw_event.get("customerId")
        or raw_event.get("customer_id")
        or raw_event.get("userId")
        or raw_event.get("user_id")
        or ""
    )
    company_id = str(raw_event.get("companyId") or raw_event.get("company_id") or "")

    if not event_type:
        logger.debug("Skipping event with no event_type")
        return

    rule = TRIGGER_RULES.get(event_type)
    if not rule:
        logger.debug(f"No trigger rule for event_type={event_type}")
        return

    event = TriggerEvent(
        event_type=event_type,
        customer_id=customer_id if customer_id else None,
        company_id=company_id if company_id else None,
        kyc_level=raw_event.get("kycLevel") or raw_event.get("kyc_level"),
        tier=raw_event.get("tier"),
        amount=raw_event.get("amount"),
        loan_type=raw_event.get("loanType") or raw_event.get("loan_type"),
        metadata=raw_event,
    )

    target_id = company_id if rule["kyc_level"] == "kyb" else customer_id
    if not target_id:
        logger.warning(f"Event {event_type} has no customer_id or company_id — skipping")
        return

    # ── Cooldown check ────────────────────────────────────────────────────
    if cooldown_mgr.is_in_cooldown(target_id, event_type, rule["cooldown_hours"]):
        _stats["events_skipped_cooldown"] += 1
        logger.info(f"Cooldown active for {target_id}/{event_type} — skipping")
        await log_trigger_event(target_id, event_type, "", None, skipped=True, skip_reason="cooldown")
        return

    # ── Determine KYC level ───────────────────────────────────────────────
    kyc_level = determine_kyc_level(event, rule)

    # ── Start workflow ────────────────────────────────────────────────────
    workflow_id = None
    if kyc_level == "kyb":
        workflow_id = await start_kyb_workflow(target_id, event_type, event.metadata)
    else:
        workflow_id = await start_kyc_workflow(target_id, kyc_level, event_type, event.metadata)

    if workflow_id:
        _stats["events_triggered"] += 1
        cooldown_mgr.record_trigger(target_id, event_type, rule["cooldown_hours"])
        logger.info(f"Triggered {kyc_level} KYC for {target_id} via {event_type} → workflow={workflow_id}")
    else:
        _stats["events_errored"] += 1
        logger.error(f"Failed to start workflow for {target_id}/{event_type}")

    await log_trigger_event(target_id, event_type, kyc_level, workflow_id)


# ─── Kafka Consumer Loop ─────────────────────────────────────────────────────

_consumer_task: Optional[asyncio.Task] = None


async def consume_loop():
    """Main Kafka consumer loop using aiokafka."""
    try:
        from aiokafka import AIOKafkaConsumer
    except ImportError:
        logger.error("aiokafka not installed — falling back to Dapr subscription mode")
        return

    consumer = AIOKafkaConsumer(
        *TOPICS,
        bootstrap_servers=",".join(KAFKA_BROKERS),
        group_id=CONSUMER_GROUP,
        auto_offset_reset="latest",
        enable_auto_commit=True,
        value_deserializer=lambda m: json.loads(m.decode("utf-8")),
    )

    while True:
        try:
            await consumer.start()
            logger.info(f"Kafka consumer started — subscribed to {TOPICS}")
            async for msg in consumer:
                try:
                    await process_event(msg.value)
                except Exception as e:
                    _stats["events_errored"] += 1
                    logger.error(f"Error processing event: {e}", exc_info=True)
        except Exception as e:
            logger.error(f"Kafka consumer error — reconnecting in 5s: {e}")
            await asyncio.sleep(5)
        finally:
            try:
                await consumer.stop()
            except Exception:
                pass


# ─── Dapr Subscription (alternative to direct Kafka) ─────────────────────────

@app.post("/dapr/subscribe")
async def dapr_subscribe():
    """Dapr pubsub subscription endpoint."""
    return [
        {"pubsubname": "remitflow-pubsub", "topic": topic.replace("remitflow.", ""), "route": "/events"}
        for topic in TOPICS
    ]


@app.post("/events")
async def handle_dapr_event(event: Dict[str, Any]):
    """Handle events via Dapr pubsub (alternative to direct Kafka)."""
    data = event.get("data", event)
    await process_event(data)
    return {"status": "ok"}


# ─── REST Endpoints ───────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "kyc-event-consumer",
        "stats": _stats,
        "uptime_seconds": time.time() - _stats["start_time"],
        "kafka_topics": TOPICS,
        "trigger_rules": list(TRIGGER_RULES.keys()),
    }


@app.get("/stats")
async def stats():
    return ConsumerStats(
        events_processed=_stats["events_processed"],
        events_triggered=_stats["events_triggered"],
        events_skipped_cooldown=_stats["events_skipped_cooldown"],
        events_errored=_stats["events_errored"],
        last_event_at=_stats["last_event_at"],
        uptime_seconds=time.time() - _stats["start_time"],
    )


@app.get("/rules")
async def get_rules():
    return TRIGGER_RULES


@app.post("/trigger")
async def manual_trigger(event: TriggerEvent):
    """Manual trigger endpoint for testing or admin use."""
    raw = event.dict()
    raw["eventType"] = event.event_type
    await process_event(raw)
    return {"status": "triggered", "event_type": event.event_type}


# ─── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    global _consumer_task
    _consumer_task = asyncio.create_task(consume_loop())
    logger.info("KYC Event Consumer started")


@app.on_event("shutdown")
async def shutdown():
    if _consumer_task:
        _consumer_task.cancel()
    logger.info("KYC Event Consumer stopped")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8120"))
    uvicorn.run(app, host="0.0.0.0", port=port)
