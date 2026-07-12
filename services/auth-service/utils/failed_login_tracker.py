"""
Failed Login Attempt Tracking and Account Suspension Service.

Redis-backed (not in-memory) so counters are correct across multiple
auth-service replicas — a single-process in-memory dict would let an
attacker reset their attempt count just by hitting a different pod.
"""

import json
from datetime import timedelta
from typing import Optional, Dict

import redis as redis_lib
from sqlalchemy.orm import Session

from utils.config import get_config
from utils.external_api_client import ExternalAPIClient
from utils.helpers import create_logger

logger = create_logger(__name__)
config = get_config()

_redis_client: Optional[redis_lib.Redis] = None


def _get_redis() -> redis_lib.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis_lib.from_url(config.REDIS_URL, decode_responses=True)
    return _redis_client


class FailedLoginTracker:
    """Tracks failed login attempts and triggers account suspension after
    threshold. Attempt state lives in Redis, keyed by tenant+email, with a
    TTL matching the lockout window so it self-resets."""

    MAX_ATTEMPTS = 6
    LOCKOUT_DURATION_MINUTES = 30

    _KEY = "authsvc:failed_login:{tenant_id}:{email}"

    def __init__(self, db: Session):
        self.db = db

    def record_failed_attempt(
        self, email: str, tenant_id: str, keycloak_id: Optional[str] = None
    ) -> Dict:
        """Record a failed login attempt. Returns
        {attempts, remaining, suspended, lockout_until}."""
        r = _get_redis()
        key = self._KEY.format(tenant_id=tenant_id, email=email)
        ttl_seconds = self.LOCKOUT_DURATION_MINUTES * 60

        pipe = r.pipeline(transaction=True)
        pipe.incr(key)
        pipe.ttl(key)
        attempts, ttl = pipe.execute()
        attempts = int(attempts)

        if ttl == -1:  # first attempt in this window, or TTL was somehow lost
            r.expire(key, ttl_seconds)

        if keycloak_id:
            r.set(f"{key}:keycloak_id", keycloak_id, ex=ttl_seconds)

        remaining = max(0, self.MAX_ATTEMPTS - attempts)

        logger.warning(
            f"Failed login attempt {attempts}/{self.MAX_ATTEMPTS} for {email} (tenant: {tenant_id})"
        )

        result = {
            "attempts": attempts,
            "remaining": remaining,
            "suspended": False,
            "lockout_until": None,
        }

        if attempts >= self.MAX_ATTEMPTS:
            logger.critical(
                f"Max failed login attempts reached for {email}. Triggering account suspension."
            )
            if keycloak_id:
                result["suspended"] = self._suspend_account(
                    keycloak_id=keycloak_id, tenant_id=tenant_id, email=email
                )
            else:
                logger.error(f"Cannot suspend account for {email} — keycloak_id not available")

            result["lockout_until"] = (
                json.dumps({"minutes": self.LOCKOUT_DURATION_MINUTES})
            )

        return result

    def reset_attempts(self, email: str, tenant_id: str):
        """Reset failed attempts counter (e.g., after successful login)."""
        r = _get_redis()
        key = self._KEY.format(tenant_id=tenant_id, email=email)
        r.delete(key, f"{key}:keycloak_id")
        logger.info(f"Reset failed login attempts for {email}")

    def get_remaining_attempts(self, email: str, tenant_id: str) -> int:
        r = _get_redis()
        key = self._KEY.format(tenant_id=tenant_id, email=email)
        attempts = r.get(key)
        if attempts is None:
            return self.MAX_ATTEMPTS
        return max(0, self.MAX_ATTEMPTS - int(attempts))

    def _suspend_account(self, keycloak_id: str, tenant_id: str, email: str) -> bool:
        """Suspend a user or admin account via the corresponding service's
        internal HTTP API."""
        try:
            user_details = self._get_user_or_admin_details(keycloak_id, tenant_id)
            if not user_details:
                logger.error(f"Failed to get user/admin details for keycloak_id: {keycloak_id}")
                return False

            account_type = user_details["type"]
            account_id = user_details["id"]
            success = self._call_suspension_api(account_type, account_id, tenant_id)

            if success:
                logger.info(f"Successfully suspended {account_type} account: {email} (ID: {account_id})")
            else:
                logger.error(f"Failed to suspend {account_type} account: {email} (ID: {account_id})")
            return success
        except Exception as e:
            logger.error(f"Error suspending account for {email}: {e}")
            return False

    def _get_user_or_admin_details(self, keycloak_id: str, tenant_id: str) -> Optional[Dict]:
        """Look up the account's own internal ID (needed for the suspension
        endpoint, which takes the account's own PK, not its keycloak_id)."""
        base_url = config.INTERNAL_API_BASE_URL
        if not base_url:
            logger.error("INTERNAL_API_BASE_URL is not configured — cannot suspend account.")
            return None

        headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}

        try:
            user_client = ExternalAPIClient(base_url=base_url, headers=headers)
            user_response = user_client._get(endpoint="/user/user", params={"keycloak_id": keycloak_id})
            if user_response and user_response.get("user"):
                user_data = user_response["user"]
                return {"type": "user", "id": user_data["id"], "data": user_data}
        except Exception as e:
            logger.info(f"Not a user account (keycloak_id: {keycloak_id}): {e}. Trying admin...")

        try:
            admin_client = ExternalAPIClient(base_url=base_url, headers=headers)
            admin_response = admin_client._get(endpoint=f"/admin/admin/keycloak/{keycloak_id}")
            if admin_response and admin_response.get("admin"):
                admin_data = admin_response["admin"]
                return {"type": "admin", "id": admin_data["id"], "data": admin_data}
        except Exception as e:
            logger.error(f"Not an admin account (keycloak_id: {keycloak_id}): {e}")

        logger.error(f"Could not find user or admin account with keycloak_id: {keycloak_id}")
        return None

    def _call_suspension_api(self, account_type: str, account_id: str, tenant_id: str) -> bool:
        base_url = config.INTERNAL_API_BASE_URL
        if not base_url:
            return False

        headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}
        client = ExternalAPIClient(base_url=base_url, headers=headers)

        try:
            if account_type == "user":
                response = client._put(endpoint=f"/user/user/{account_id}/suspend", get_response=False)
            else:
                response = client._patch(endpoint=f"/admin/admin/{account_id}/suspend", get_response=False)

            status_code = response.get("status_code", 0)
            if status_code == 200:
                logger.info(f"Successfully suspended {account_type} ID: {account_id}")
                return True
            logger.error(f"Failed to suspend {account_type} ID: {account_id}. Status: {status_code}")
            return False
        except Exception as e:
            logger.error(f"Error calling suspension API for {account_type} ID {account_id}: {e}")
            return False


_failed_login_tracker_instance: Optional[FailedLoginTracker] = None


def get_failed_login_tracker(db: Session) -> FailedLoginTracker:
    global _failed_login_tracker_instance
    if _failed_login_tracker_instance is None:
        _failed_login_tracker_instance = FailedLoginTracker(db)
    return _failed_login_tracker_instance
