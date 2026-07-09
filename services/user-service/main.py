import atexit
import logging

from fastapi import FastAPI

from api import feedback_router, health_router, user_router
from database import Base, engine
from middlewares.audit import AuditMiddleware
from middlewares.required_headers import RequiredHeadersMiddleware
from utils.config import get_config

config = get_config()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="user-service",
    description="Customer identity, KYC, and feedback management for 54remit.",
    version="1.0.0",
    root_path=config.ROOT_PATH,
)

app.add_middleware(
    RequiredHeadersMiddleware,
    required_headers=["x-tenant-id", "x-keycloak-id"],
    exclude_prefixes=["/health", "/dapr", "/metrics"],
)
app.add_middleware(AuditMiddleware)

# Schema is managed via Alembic (`alembic upgrade head`) — create_all here is
# just a dev-convenience fallback so a fresh local DB isn't empty on first run.
Base.metadata.create_all(bind=engine)

app.include_router(health_router, prefix="")
app.include_router(user_router, prefix="/user")
app.include_router(feedback_router, prefix="/user/feedback")


@app.get("/metrics/kafka")
def kafka_metrics():
    from utils.kafka_instance import KafkaClientInstance

    return {
        "connected": KafkaClientInstance.is_connected(),
        "metrics": KafkaClientInstance.get_metrics(),
    }


@app.on_event("startup")
def on_startup():
    logger.info("user-service starting up")


def _shutdown_kafka():
    try:
        from utils.kafka_instance import KafkaClientInstance

        KafkaClientInstance.close()
    except Exception:
        pass


atexit.register(_shutdown_kafka)
