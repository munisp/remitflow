"""
Main Temporal Worker for Nigerian Remittance Platform
Registers and executes all workflows and activities
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from temporalio.client import Client
from temporalio.worker import Worker

# Import workflows
from workflows.payment_workflow import PaymentProcessingWorkflow, PaymentRefundWorkflow
from workflows.kyc_workflow import KYCVerificationWorkflow, KYCUpdateWorkflow
from workflows.fraud_workflow import FraudDetectionWorkflow, FraudInvestigationWorkflow

# Import activities
from activities import payment_activities
from activities import kyc_activities
from activities import fraud_activities

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


async def main():
    """
    Main worker function
    Connects to Temporal server and starts worker
    """
    logger.info("Starting Temporal worker...")
    
    # Connect to Temporal server
    temporal_address = "localhost:7233"  # Update for production
    
    try:
        client = await Client.connect(temporal_address)
        logger.info(f"Connected to Temporal server at {temporal_address}")
    except Exception as e:
        logger.error(f"Failed to connect to Temporal server: {str(e)}")
        sys.exit(1)
    
    # Create worker for payment workflows
    payment_worker = Worker(
        client,
        task_queue="payment-task-queue",
        workflows=[PaymentProcessingWorkflow, PaymentRefundWorkflow],
        activities=[
            payment_activities.validate_payment,
            payment_activities.check_fraud,
            payment_activities.process_payment,
            payment_activities.settle_payment,
            payment_activities.refund_payment,
            payment_activities.send_notification,
        ],
    )
    logger.info("Payment worker configured")
    
    # Create worker for KYC workflows
    kyc_worker = Worker(
        client,
        task_queue="kyc-task-queue",
        workflows=[KYCVerificationWorkflow, KYCUpdateWorkflow],
        activities=[
            kyc_activities.collect_documents,
            kyc_activities.verify_identity_ocr,
            kyc_activities.check_sanctions,
            kyc_activities.verify_business_opensource,
            kyc_activities.approve_kyc,
            kyc_activities.reject_kyc,
            kyc_activities.send_kyc_notification,
        ],
    )
    logger.info("KYC worker configured")
    
    # Create worker for fraud detection workflows
    fraud_worker = Worker(
        client,
        task_queue="fraud-task-queue",
        workflows=[FraudDetectionWorkflow, FraudInvestigationWorkflow],
        activities=[
            fraud_activities.extract_transaction_features,
            fraud_activities.run_rule_based_detection,
            fraud_activities.run_gnn_fraud_detection,
            fraud_activities.run_ml_models,
            fraud_activities.calculate_ensemble_score,
            fraud_activities.flag_suspicious_transaction,
            fraud_activities.block_transaction,
            fraud_activities.send_fraud_alert,
        ],
    )
    logger.info("Fraud detection worker configured")
    
    # Run all workers concurrently
    logger.info("Starting all workers...")
    try:
        await asyncio.gather(
            payment_worker.run(),
            kyc_worker.run(),
            fraud_worker.run(),
        )
    except KeyboardInterrupt:
        logger.info("Worker shutdown requested")
    except Exception as e:
        logger.error(f"Worker error: {str(e)}")
        raise
    finally:
        logger.info("Workers stopped")


if __name__ == "__main__":
    asyncio.run(main())

