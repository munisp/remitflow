
"""
KYC Integration Services - Production Implementation
Integrates Face Verification, PEP Screening, and other KYC services into the user onboarding flow.
"""

import asyncio
import logging
import httpx
import os
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

# --- Service URLs ---
FACE_VERIFICATION_SERVICE_URL = os.getenv("FACE_VERIFICATION_SERVICE_URL", "http://face-verification-service:8000")
PEP_SCREENING_SERVICE_URL = os.getenv("PEP_SCREENING_SERVICE_URL", "http://pep-screening-service:8000")
KYC_ENHANCED_SERVICE_URL = os.getenv("KYC_ENHANCED_SERVICE_URL", "http://kyc-enhanced-service:8000")

# --- HTTP Client ---
async def get_client():
    return httpx.AsyncClient()

class FaceVerificationIntegration:
    """
    Integrates the Face Verification service into the onboarding process.
    Connects to: services/kyc-enhanced/face-verification/src/face_verification_service.py
    """
    def __init__(self):
        # No db_connection needed as this is a service client
        pass

    async def verify_user_face(self, user_id: str, selfie_url: str, id_photo_url: str) -> Dict[str, Any]:
        """Verifies a user's face against their ID photo using the Face Verification Service."""
        logger.info(f"Verifying face for user {user_id}")
        async with await get_client() as client:
            try:
                payload = {"selfie_image_url": selfie_url, "reference_image_url": id_photo_url}
                response = await client.post(f"{FACE_VERIFICATION_SERVICE_URL}/verify-face-match", json=payload)
                response.raise_for_status()
                result = response.json()

                # In a real app, you would store this result and update KYC status
                if result.get("match_result", {}).get("is_match"):
                    logger.info(f"Face verified for user {user_id}. Similarity: {result.get("match_result", {}).get("similarity")}")
                else:
                    logger.warning(f"Face verification failed for user {user_id}. Reason: {result.get("match_result", {}).get("error")}")
                    # Flag for manual review
                    await self._flag_for_manual_review(user_id, "face_verification_failed", result.get("match_result", {}).get("error", "Similarity score too low"))

                return {"success": True, "data": result}

            except httpx.HTTPStatusError as e:
                logger.error(f"Face verification HTTP error for user {user_id}: {e.response.text}")
                return {"success": False, "error": e.response.json().get("detail", "HTTP error")}
            except Exception as e:
                logger.error(f"Face verification error for user {user_id}: {e}")
                return {"success": False, "error": str(e)}

    async def verify_liveness(self, user_id: str, video_url: str) -> Dict[str, Any]:
        """Verifies liveness from a video using the Face Verification Service."""
        logger.info(f"Verifying liveness for user {user_id}")
        async with await get_client() as client:
            try:
                payload = {"video_url": video_url, "check_types": ["blink", "head_movement"]}
                response = await client.post(f"{FACE_VERIFICATION_SERVICE_URL}/detect-liveness", json=payload)
                response.raise_for_status()
                result = response.json()

                if not result.get("liveness_result", {}).get("is_live"):
                     await self._flag_for_manual_review(user_id, "liveness_failed", "Liveness checks failed")

                return {"success": True, "data": result}

            except httpx.HTTPStatusError as e:
                logger.error(f"Liveness check HTTP error for user {user_id}: {e.response.text}")
                return {"success": False, "error": e.response.json().get("detail", "HTTP error")}
            except Exception as e:
                logger.error(f"Liveness verification error for user {user_id}: {e}")
                return {"success": False, "error": str(e)}

    async def _flag_for_manual_review(self, user_id: str, reason_code: str, reason: str, priority: str = "MEDIUM") -> None:
        """Flags a user for manual review by creating a case in the enhanced KYC service."""
        logger.warning(f"User {user_id} flagged for manual review: {reason}")
        async with await get_client() as client:
            try:
                payload = {
                    "customer_id": user_id,
                    "case_type": "ONBOARDING_REVIEW",
                    "status": "OPEN",
                    "priority": priority,
                    "summary": f"Manual review required: {reason_code}",
                    "context": {"reason": reason}
                }
                await client.post(f"{KYC_ENHANCED_SERVICE_URL}/cases", json=payload)
            except Exception as e:
                logger.error(f"Failed to flag user {user_id} for manual review: {e}")

class PEPScreeningIntegration:
    """
    Integrates the PEP Screening service into the onboarding process.
    Connects to: services/kyc-enhanced/pep-screening/src/pep_screening_service.py
    """
    def __init__(self):
        pass

    async def screen_user(self, user_id: str, user_data: Dict[str, str]) -> Dict[str, Any]:
        """Screens a user for PEP and sanctions using the PEP Screening Service."""
        logger.info(f"Screening user {user_id} for PEP and sanctions.")
        async with await get_client() as client:
            try:
                # The user_data should contain name, dob, nationality etc.
                response = await client.post(f"{PEP_SCREENING_SERVICE_URL}/screen-individual", json=user_data)
                response.raise_for_status()
                result = response.json()

                if result.get("pep_match") or result.get("sanctions_match"):
                    await self._flag_for_manual_review(
                        user_id,
                        "pep_or_sanctions_match",
                        "PEP or sanctions match detected",
                        priority="HIGH"
                    )
                
                return {"success": True, "data": result}

            except httpx.HTTPStatusError as e:
                logger.error(f"PEP screening HTTP error for user {user_id}: {e.response.text}")
                return {"success": False, "error": e.response.json().get("detail", "HTTP error")}
            except Exception as e:
                logger.error(f"PEP screening error for user {user_id}: {e}")
                return {"success": False, "error": str(e)}

    async def _flag_for_manual_review(self, user_id: str, reason_code: str, reason: str, priority: str = "HIGH") -> None:
        """Re-uses the same manual review flagging mechanism."""
        logger.warning(f"User {user_id} flagged for high-priority manual review: {reason}")
        async with await get_client() as client:
            try:
                payload = {
                    "customer_id": user_id,
                    "case_type": "ONBOARDING_REVIEW",
                    "status": "OPEN",
                    "priority": priority,
                    "summary": f"Manual review required: {reason_code}",
                    "context": {"reason": reason}
                }
                await client.post(f"{KYC_ENHANCED_SERVICE_URL}/cases", json=payload)
            except Exception as e:
                logger.error(f"Failed to flag user {user_id} for manual review: {e}")
