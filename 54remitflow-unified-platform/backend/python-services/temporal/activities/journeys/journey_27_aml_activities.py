
"""
AML Monitoring Temporal Activities - Production Implementation
Journey: journey_27_aml
Python Activity Workers with real service integrations for AML/CFT.
"""
import os
import httpx
from temporalio import activity
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

# --- Service URLs --- (These should be in a config file)
AML_CFT_ENGINE_URL = os.getenv("AML_CFT_ENGINE_URL", "http://aml-cft-engine:8000") # Assuming the engine is exposed as a service
KYC_ENHANCED_SERVICE_URL = os.getenv("KYC_ENHANCED_SERVICE_URL", "http://kyc-enhanced-service:8000")
NOTIFICATION_SERVICE_URL = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:8000")

# --- HTTP Client ---
async def get_client():
    # In a real app, you'd manage the client lifecycle better
    return httpx.AsyncClient()

# --- Activity Definitions ---

@activity.defn(name="ValidateAMLInput")
async def validate_input(input_data: Dict[str, Any]) -> bool:
    """Validate input for the AML Monitoring workflow (e.g., a transaction)."""
    logger.info(f"Validating input for AML monitoring: transaction {input_data.get("transaction_id")}")
    required_fields = ["transaction_id", "customer_id", "agent_id", "amount", "currency", "transaction_type"]
    if not all(field in input_data for field in required_fields):
        raise ValueError(f"Validation failed. Missing one of {required_fields}")
    logger.info("AML input validation successful.")
    return True

@activity.defn(name="ScreenCustomerActivity")
async def screen_customer_activity(customer_id: str, name: str, country: str, date_of_birth: Optional[str] = None) -> Dict[str, Any]:
    """Screens a customer against sanctions, PEP, and adverse media lists."""
    logger.info(f"Screening customer {customer_id} ({name})")
    async with await get_client() as client:
        try:
            payload = {
                "customer_id": customer_id,
                "name": name,
                "country": country,
                "date_of_birth": date_of_birth
            }
            response = await client.post(f"{AML_CFT_ENGINE_URL}/screen-customer", json=payload)
            response.raise_for_status()
            result = response.json()
            logger.info(f"Screening for customer {customer_id} completed. Match found: {result.get("match_found")}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Customer screening failed for {customer_id}: {e.response.text}")
            raise

@activity.defn(name="ProcessTransactionActivity")
async def process_transaction_activity(transaction_data: Dict[str, Any]) -> Dict[str, Any]:
    """Processes a transaction through the AML/CFT engine for risk analysis."""
    tx_id = transaction_data.get("transaction_id")
    logger.info(f"Processing transaction {tx_id} for AML risk")
    async with await get_client() as client:
        try:
            response = await client.post(f"{AML_CFT_ENGINE_URL}/process-transaction", json=transaction_data)
            response.raise_for_status()
            result = response.json()
            logger.info(f"Transaction {tx_id} processed. Blocked: {result.get("blocked")}, Requires Review: {result.get("requires_review")}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"AML processing for transaction {tx_id} failed: {e.response.text}")
            raise

@activity.defn(name="CreateCaseForReviewActivity")
async def create_case_for_review_activity(customer_id: str, transaction_id: str, reason: str, risk_level: str) -> Dict[str, Any]:
    """Creates a case in the compliance queue for manual review."""
    logger.info(f"Creating compliance case for transaction {transaction_id} due to {reason}")
    async with await get_client() as client:
        try:
            payload = {
                "customer_id": customer_id,
                "case_type": "AML_ALERT",
                "status": "OPEN",
                "priority": "HIGH" if risk_level in ["CRITICAL", "HIGH"] else "MEDIUM",
                "summary": f"AML Alert for transaction {transaction_id}: {reason}",
                "context": {"transaction_id": transaction_id, "risk_level": risk_level}
            }
            response = await client.post(f"{KYC_ENHANCED_SERVICE_URL}/cases", json=payload)
            response.raise_for_status()
            result = response.json()
            logger.info(f"Compliance case created: {result.get("id")}")
            return result
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to create compliance case for transaction {transaction_id}: {e.response.text}")
            raise

@activity.defn(name="SendAMLNotificationActivity")
async def send_notification_activity(user_id: str, notification_type: str, data: Optional[Dict[str, Any]] = None) -> None:
    """Sends an AML-related notification to a user or compliance officer."""
    logger.info(f"Sending AML notification \'{notification_type}\' to {user_id}")
    async with await get_client() as client:
        try:
            payload = {
                "user_id": user_id, # Can be a user or a compliance officer group alias
                "type": "EMAIL",
                "template_id": f"aml_{notification_type.lower()}",
                "data": data or {},
                "priority": "URGENT"
            }
            response = await client.post(f"{NOTIFICATION_SERVICE_URL}/send", json=payload)
            response.raise_for_status()
            logger.info(f"AML Notification sent successfully to {user_id}.")
        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to send AML notification to {user_id}: {e.response.text}")

