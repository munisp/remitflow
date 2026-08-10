from pathlib import Path

import requests

from utils.config import get_config
from utils.helpers import create_logger

logger = create_logger(__name__)
config = get_config()


def _repo_root() -> Path:
    # adapters/permify.py -> adapters -> auth-service -> services -> <repo root>
    return Path(__file__).resolve().parents[3]


def _load_canonical_schema() -> str:
    """Read the canonical RemitFlow Permify schema.

    Preference order:
      1. infrastructure/integration/permify_policies/remitflow_schema.perm (canonical)
      2. services/auth-service/schemas/permify/v2.perm (legacy fallback)

    Raises FileNotFoundError when neither exists — schema deployment must fail
    loudly rather than silently run without an authorization model.
    """
    canonical = _repo_root() / "infrastructure" / "integration" / "permify_policies" / "remitflow_schema.perm"
    legacy = Path(__file__).parent.parent / "schemas" / "permify" / "v2.perm"
    if canonical.is_file():
        return canonical.read_text()
    if legacy.is_file():
        logger.warning(f"Canonical Permify schema not found at {canonical}; falling back to legacy {legacy}")
        return legacy.read_text()
    raise FileNotFoundError(
        f"No Permify schema found (looked at {canonical} and {legacy})"
    )


def ensure_tenant(tenant_id: str) -> bool:
    """Create the Permify tenant if it does not exist (idempotent)."""
    try:
        response = requests.post(
            f"{config.PERMIFY_URL}/v1/tenants/create",
            json={"id": tenant_id, "name": tenant_id},
            timeout=10,
        )
        if response.status_code == 200:
            logger.info(f"Permify tenant '{tenant_id}' created")
            return True
        if response.status_code == 409 or "already exist" in response.text.lower():
            logger.info(f"Permify tenant '{tenant_id}' already exists")
            return True
        logger.error(f"Permify tenant creation failed: HTTP {response.status_code}: {response.text[:300]}")
        return False
    except Exception as e:
        logger.error(f"Permify tenant creation failed: {e}")
        return False


def load_schema():
    """Load the canonical Permify schema and deploy it to all pods.
    Permify uses in-memory storage across replicas, so the schema is written
    multiple times (via the load balancer) to maximize the odds every
    replica receives it."""
    try:
        schema = _load_canonical_schema()

        tenant_id = config.PERMIFY_DEFAULT_TENANT
        write_attempts = config.PERMIFY_WRITE_ATTEMPTS
        successful_writes = 0
        schema_version = "unknown"

        # Ensure the tenant exists before writing the schema (idempotent).
        if not ensure_tenant(tenant_id):
            logger.error(f"Failed to load Permify schema: tenant '{tenant_id}' could not be ensured")
            return

        for attempt in range(write_attempts):
            try:
                response = requests.post(
                    f"{config.PERMIFY_URL}/v1/tenants/{tenant_id}/schemas/write",
                    json={"schema": schema},
                    timeout=10,
                )
                if response.status_code == 200:
                    successful_writes += 1
                    result = response.json()
                    schema_version = result.get("schema_version", schema_version)
            except Exception as attempt_error:
                logger.debug(f"Schema write attempt {attempt + 1} failed: {attempt_error}")
                continue

        if successful_writes > 0:
            logger.info(
                f"Permify schema loaded (version: {schema_version}, "
                f"{successful_writes}/{write_attempts} writes succeeded)"
            )
        else:
            logger.error(f"Failed to load Permify schema: all {write_attempts} write attempts failed")
    except Exception as e:
        logger.error(f"Error loading Permify schema: {e}")


def check_permission(
    user_id: str, tenant_id: str, permission: str, entity_type: str, entity_id: str
) -> bool:
    """Check if user has permission on a specific entity."""
    try:
        payload = {
            "tenant_id": tenant_id,
            "metadata": {"schema_version": "", "snap_token": "", "depth": 20},
            "entity": {"type": entity_type, "id": entity_id},
            "permission": permission,
            "subject": {"type": "user", "id": user_id},
        }
        response = requests.post(
            f"{config.PERMIFY_URL}/v1/tenants/{tenant_id}/permissions/check",
            json=payload,
            timeout=5,
        )
        if response.status_code != 200:
            logger.error(f"Failed to check permission: {response.text}")
            return False

        result = response.json()
        can = result.get("can")
        if can == "CHECK_RESULT_ALLOWED":
            return True
        if can == "CHECK_RESULT_DENIED":
            return False
        return bool(can) if can is not None else False
    except Exception as e:
        logger.error(f"Error checking permission: {e}")
        return False


def assign_role(
    user_id: str, tenant_id: str, role: str, entity_type: str, entity_id: str
) -> bool:
    """Assign role/relation to user for a specific entity."""
    try:
        payload = {
            "metadata": {"schema_version": ""},
            "tuples": [
                {
                    "entity": {"type": entity_type, "id": entity_id},
                    "relation": role,
                    "subject": {"type": "user", "id": user_id},
                }
            ],
        }
        write_attempts = config.PERMIFY_WRITE_ATTEMPTS
        successful_writes = 0

        for attempt in range(write_attempts):
            try:
                response = requests.post(
                    f"{config.PERMIFY_URL}/v1/tenants/{tenant_id}/relationships/write",
                    json=payload,
                    timeout=5,
                )
                if response.status_code in (200, 201):
                    successful_writes += 1
            except Exception as attempt_error:
                logger.debug(f"Write attempt {attempt + 1} failed: {attempt_error}")
                continue

        if successful_writes > 0:
            logger.info(
                f"Assigned role '{role}' to {user_id} on {entity_type}:{entity_id} "
                f"({successful_writes}/{write_attempts} writes succeeded)"
            )
            return True

        logger.error(f"Failed to assign role: all {write_attempts} write attempts failed")
        return False
    except Exception as e:
        logger.error(f"Error assigning role: {e}")
        return False


def remove_role(
    user_id: str, tenant_id: str, role: str, entity_type: str, entity_id: str
) -> bool:
    """Remove role/relation from user for a specific entity."""
    try:
        payload = {
            "filter": {
                "entity": {"type": entity_type, "ids": [entity_id]},
                "relation": role,
                "subject": {"type": "user", "ids": [user_id]},
            }
        }
        delete_attempts = config.PERMIFY_WRITE_ATTEMPTS
        successful_deletes = 0

        for attempt in range(delete_attempts):
            try:
                response = requests.post(
                    f"{config.PERMIFY_URL}/v1/tenants/{tenant_id}/relationships/delete",
                    json=payload,
                    timeout=5,
                )
                if response.status_code in (200, 204):
                    successful_deletes += 1
            except Exception as attempt_error:
                logger.debug(f"Delete attempt {attempt + 1} failed: {attempt_error}")
                continue

        if successful_deletes > 0:
            logger.info(
                f"Removed role '{role}' from {user_id} on {entity_type}:{entity_id} "
                f"({successful_deletes}/{delete_attempts} deletes succeeded)"
            )
            return True

        logger.error(f"Failed to remove role: all {delete_attempts} delete attempts failed")
        return False
    except Exception as e:
        logger.error(f"Error removing role: {e}")
        return False
