import atexit
import logging

from fastapi import FastAPI

from api.v1 import auth_router, health_router, permissions_router, system_router, token_router
from database import Base, engine
from middlewares.audit import AuditMiddleware
from middlewares.required_headers import RequiredHeadersMiddleware
from utils.config import get_config

config = get_config()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="auth-service",
    description="Identity (Keycloak) + authorization (Permify ReBAC) for 54remit.",
    version="1.0.0",
    root_path=config.ROOT_PATH,
)

app.add_middleware(
    RequiredHeadersMiddleware,
    required_headers=["x-tenant-id", "x-keycloak-realm", "x-keycloak-pub-key"],
    exclude_prefixes=["/health", "/dapr", "/system", "/metrics"],
)
app.add_middleware(AuditMiddleware)

# Schema is managed via Alembic (`alembic upgrade head`) — create_all here is
# just a dev-convenience fallback so a fresh local DB isn't empty on first run.
Base.metadata.create_all(bind=engine)

app.include_router(health_router, prefix="")
app.include_router(auth_router, prefix="/auth")
app.include_router(token_router, prefix="/token")
app.include_router(system_router, prefix="/system")
app.include_router(permissions_router, prefix="/permissions")


@app.on_event("startup")
def on_startup():
    logger.info("auth-service starting up")
    try:
        from adapters.permify import load_schema

        load_schema()
    except Exception as e:
        logger.error(f"Failed to load Permify schema on startup: {e}")


def _shutdown_kafka():
    try:
        from utils.kafka_instance import KafkaClientInstance

        KafkaClientInstance.close()
    except Exception:
        pass


atexit.register(_shutdown_kafka)
