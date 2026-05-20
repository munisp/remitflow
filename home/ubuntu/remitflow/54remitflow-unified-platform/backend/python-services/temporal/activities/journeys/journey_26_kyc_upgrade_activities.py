
"""
KYC Upgrade Temporal Activities - Production Implementation
Journey: journey_26_kyc_upgrade
Python Activity Workers with real service integrations.
"""
import os
import httpx
from temporalio import activity
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

# --- Service URLs --- (These should be in a config file)
KYC_SERVICE_URL = os.getenv("KYC_SERVICE_URL", "http://kyc-service:8000")
VIDEO_KYC_SERVICE_URL = os.getenv("VIDEO_KYC_SERVICE_URL", "http://video-kyc-service:8000")
KYC_ENHANCED_SERVICE_URL = os.getenv("KYC_ENHANCED_SERVICE_URL", "http://kyc-enhanced-service:8000")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8000")

# --- HTTP Client --- 
async def get_client():
    # In a real app, you'd manage the client lifecycle better
    return httpx.AsyncClient()

# --- Activity Definitions ---

@activity.defn(name="ValidateKYCUpgradeInput")
async def validate_input(input_data: Dict[str, Any]) -> bool:
    """Validate input for the KYC Upgrade workflow."""
    logger.info(f"Validating input for KYC upgrade: {input_data.get('user_id')}")
    required_fields = ["user_id", "target_tier"]
    if not all(field in input_data for field in required_fields):
        raise ValueError(f"Validation failed. Missing one of {required_fields}")
    logger.info("Input validation successful.")
    return True

@activity.defn(name="CheckEligibilityActivity")
async def check_eligibility_activity(user_id: str, target_tier: str) -> Dict[str, Any]:
    """Check if a user is eligible to upgrade to the target KYC tier."""
    logger.info(f"Checking eligibility for user {user_id} to upgrade to {target_tier}")
    async with await get_client() as client:
        try:
            response = await client.get(f"{KYC_SERVICE_URL}/profiles/{user_id}/tier-eligibility?target_tier={target_tier}")
            response.raise_for_status()
            result = response.json()
            logger.info(f"Eligibility check for user {user_id} successful: {result}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Eligibility check failed for user {user_id}: {e.response.text}")
            raise

@activity.defn(name="RequestDocumentUploadActivity")
async def request_document_upload_activity(user_id: str, documents: list) -> Dict[str, Any]:
    """Requests the user to upload required documents."""
    logger.info(f"Requesting documents {documents} from user {user_id}")
    # This activity would typically trigger a notification and wait for a signal
    # For now, we simulate sending the notification and returning.
    await send_notification_activity(user_id, "kyc_documents_required", {"documents": documents})
    return {"status": "pending_upload", "required_documents": documents}

@activity.defn(name="InitiateVideoKYCActivity")
async def initiate_video_kyc_activity(user_id: str, case_id: str) -> Dict[str, Any]:
    """Initiates a Video KYC session for the user."""
    logger.info(f"Initiating Video KYC for user {user_id}, case {case_id}")
    async with await get_client() as client:
        try:
            response = await client.post(f"{VIDEO_KYC_SERVICE_URL}/sessions", json={"user_id": user_id, "case_id": case_id})
            response.raise_for_status()
            result = response.json()
            logger.info(f"Video KYC session initiated: {result.get('session_id')}")
            # Notify user with the link to join the session
            await send_notification_activity(user_id, "video_kyc_initiated", {"session_url": result.get("session_url")})
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to initiate Video KYC for user {user_id}: {e.response.text}")
            raise

@activity.defn(name="CreateEnhancedDiligenceCaseActivity")
async def create_enhanced_diligence_case_activity(user_id: str, target_tier: str) -> Dict[str, Any]:
    """Creates an Enhanced Due Diligence (EDD) case for high-risk upgrades."""
    logger.info(f"Creating EDD case for user {user_id} for tier {target_tier}")
    async with await get_client() as client:
        try:
            payload = {
                "customer_id": user_id,
                "case_type": "KYC_UPGRADE",
                "status": "OPEN",
                "priority": "MEDIUM",
                "summary": f"Enhanced due diligence for upgrade to {target_tier}"
            }
            response = await client.post(f"{KYC_ENHANCED_SERVICE_URL}/cases", json=payload)
            response.raise_for_status()
            result = response.json()
            logger.info(f"EDD case created: {result.get('id')}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to create EDD case for user {user_id}: {e.response.text}")
            raise

@activity.defn(name="FinalizeTierUpgradeActivity")
async def finalize_tier_upgrade_activity(user_id: str, target_tier: str) -> Dict[str, Any]:
    """Calls the KYC service to finalize the tier upgrade after all checks pass."""
    logger.info(f"Finalizing tier upgrade for user {user_id} to {target_tier}")
    async with await get_client() as client:
        try:
            response = await client.post(f"{KYC_SERVICE_URL}/profiles/{user_id}/upgrade-tier", json={"target_tier": target_tier})
            response.raise_for_status()
            result = response.json()
            logger.info(f"Tier upgrade for user {user_id} finalized successfully.")
            await send_notification_activity(user_id, "kyc_upgrade_successful", {"new_tier": target_tier})
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Tier upgrade finalization failed for user {user_id}: {e.response.text}")
            await send_notification_activity(user_id, "kyc_upgrade_failed", {"tier": target_tier, "reason": e.response.json().get("detail")})
            raise

@activity.defn(name="SendKYCNotificationActivity")
async def send_notification_activity(user_id: str, notification_type: str, data: Optional[Dict[str, Any]] = None) -> None:
    """Sends a notification to the user via the Notification Service."""
    logger.info(f"Sending notification '{notification_type}' to user {user_id}")
    async with await get_client() as client:
        try:
            payload = {
                "user_id": user_id,
                "type": "EMAIL", # Or SMS, PUSH etc.
                "template_id": f"kyc_{notification_type.lower()}",
                "data": data or {},
                "priority": "HIGH"
            }
            response = await client.post(f"{NOTIFICATION_SERVICE_URL}/send", json=payload)
            response.raise_for_status()
            logger.info(f"Notification sent successfully to user {user_id}.")
        except httpx.HTTPStatusError as e:
            # Non-critical error, just log it
            logger.error(f"Failed to send notification to user {user_id}: {e.response.text}")

