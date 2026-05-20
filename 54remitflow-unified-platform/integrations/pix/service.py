import logging
from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import status
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from . import models, schemas

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# --- Custom Exceptions ---

class PixIntegrationError(Exception):
    """Base exception for PIX integration service errors."""
    def __init__(self, name: str, message: str, status_code: int = status.HTTP_400_BAD_REQUEST):
        self.name = name
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class PixKeyNotFoundError(PixIntegrationError):
    def __init__(self, key_value: str):
        super().__init__(
            name="PixKeyNotFoundError",
            message=f"PIX Key '{key_value}' not found.",
            status_code=status.HTTP_404_NOT_FOUND
        )

class PixKeyAlreadyExistsError(PixIntegrationError):
    def __init__(self, key_value: str):
        super().__init__(
            name="PixKeyAlreadyExistsError",
            message=f"PIX Key '{key_value}' already exists.",
            status_code=status.HTTP_409_CONFLICT
        )

class PixChargeNotFoundError(PixIntegrationError):
    def __init__(self, charge_id: int):
        super().__init__(
            name="PixChargeNotFoundError",
            message=f"PIX Charge with ID '{charge_id}' not found.",
            status_code=status.HTTP_404_NOT_FOUND
        )

class PixChargeExpiredError(PixIntegrationError):
    def __init__(self, charge_id: int):
        super().__init__(
            name="PixChargeExpiredError",
            message=f"PIX Charge with ID '{charge_id}' has expired.",
            status_code=status.HTTP_400_BAD_REQUEST
        )

class PixTransactionAlreadyProcessedError(PixIntegrationError):
    def __init__(self, charge_id: int):
        super().__init__(
            name="PixTransactionAlreadyProcessedError",
            message=f"PIX Charge with ID '{charge_id}' has already been paid.",
            status_code=status.HTTP_409_CONFLICT
        )

# --- Helper Functions (Mocking External PIX API) ---

def generate_mock_qr_code_payload(charge_data: schemas.PixChargeCreate, key_value: str, charge_id: int) -> str:
    """
    Mocks the generation of a BR Code payload (PIX QR Code data).
    In a real application, this would involve calling an external PIX API.
    """
    # Example BR Code structure (simplified for mock)
    # Payload: 00020101021226580014BR.GOV.BCB.PIX0136<key_value>5204000053039865405<amount>5802BR5913<recipient_name>6008<city>62070503***6304<CRC>
    # We will use a simple string for the mock.
    amount_str = f"{charge_data.amount:.2f}".replace('.', '')
    payload = f"MOCK_BR_CODE_PAYLOAD|KEY:{key_value}|AMOUNT:{amount_str}|ID:{charge_id}"
    logger.info(f"Generated mock QR code payload for charge ID {charge_id}")
    return payload

# --- Service Class ---

class PixService:
    def __init__(self, db: Session):
        self.db = db

    # --- PIX Key Operations ---

    def create_pix_key(self, key_data: schemas.PixKeyCreate) -> models.PixKey:
        """Registers a new PIX key for a user."""
        # Check for existing key
        existing_key = self.db.query(models.PixKey).filter(models.PixKey.key_value == key_data.key_value).first()
        if existing_key:
            raise PixKeyAlreadyExistsError(key_data.key_value)

        db_key = models.PixKey(
            user_id=key_data.user_id,
            key_type=key_data.key_type,
            key_value=key_data.key_value,
            status=models.PixKeyStatus.ACTIVE # Default to active upon creation
        )
        try:
            self.db.add(db_key)
            self.db.commit()
            self.db.refresh(db_key)
            logger.info(f"Created new PIX key: {db_key.key_value} for user {db_key.user_id}")
            return db_key
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Database integrity error during key creation: {e}")
            raise PixKeyAlreadyExistsError(key_data.key_value) # Catching a potential race condition

    def get_pix_key_by_value(self, key_value: str) -> models.PixKey:
        """Retrieves a PIX key by its value."""
        db_key = self.db.query(models.PixKey).filter(models.PixKey.key_value == key_value).first()
        if not db_key:
            raise PixKeyNotFoundError(key_value)
        return db_key

    def get_pix_key_by_id(self, key_id: int) -> models.PixKey:
        """Retrieves a PIX key by its ID."""
        db_key = self.db.query(models.PixKey).filter(models.PixKey.id == key_id).first()
        if not db_key:
            raise PixKeyNotFoundError(f"ID: {key_id}")
        return db_key

    def list_pix_keys_by_user(self, user_id: int) -> List[models.PixKey]:
        """Lists all PIX keys for a given user ID."""
        return self.db.query(models.PixKey).filter(models.PixKey.user_id == user_id).all()

    def delete_pix_key(self, key_value: str):
        """Deletes a PIX key by its value."""
        db_key = self.get_pix_key_by_value(key_value)
        self.db.delete(db_key)
        self.db.commit()
        logger.info(f"Deleted PIX key: {key_value}")
        return {"message": f"PIX Key '{key_value}' deleted successfully."}

    # --- PIX Charge Operations (QR Code Generation) ---

    def create_pix_charge(self, charge_data: schemas.PixChargeCreate) -> models.PixCharge:
        """Creates a new PIX charge (payment request) and generates a QR code payload."""
        recipient_key = self.get_pix_key_by_value(charge_data.recipient_key_value)

        expires_at = datetime.now() + timedelta(seconds=charge_data.expires_in_seconds)

        # Create the charge object first to get an ID for the mock payload
        db_charge = models.PixCharge(
            recipient_key_id=recipient_key.id,
            amount=charge_data.amount,
            description=charge_data.description,
            status=models.PixChargeStatus.PENDING,
            expires_at=expires_at
        )
        self.db.add(db_charge)
        self.db.flush() # Flush to get the ID before commit

        # Generate mock QR code payload using the new charge ID
        qr_code_payload = generate_mock_qr_code_payload(charge_data, recipient_key.key_value, db_charge.id)
        db_charge.qr_code_payload = qr_code_payload

        self.db.commit()
        self.db.refresh(db_charge)
        logger.info(f"Created new PIX charge ID {db_charge.id} for key {recipient_key.key_value}")
        return db_charge

    def get_pix_charge(self, charge_id: int) -> models.PixCharge:
        """Retrieves a PIX charge by its ID."""
        db_charge = self.db.query(models.PixCharge).filter(models.PixCharge.id == charge_id).first()
        if not db_charge:
            raise PixChargeNotFoundError(charge_id)
        return db_charge

    # --- PIX Transaction Operations (Payment Processing) ---

    def process_incoming_transaction(self, transaction_data: schemas.PixTransactionReceive) -> models.PixTransaction:
        """
        Processes an incoming PIX transaction.
        This simulates the webhook/callback from the PIX system confirming a payment.
        """
        recipient_key = self.get_pix_key_by_value(transaction_data.recipient_key_value)

        # Check if transaction with this external ID is already processed
        existing_transaction = self.db.query(models.PixTransaction).filter(
            models.PixTransaction.transaction_id == transaction_data.transaction_id
        ).first()
        if existing_transaction:
            logger.warning(f"Duplicate transaction ID received: {transaction_data.transaction_id}. Ignoring.")
            return existing_transaction # Return existing one as idempotent operation

        db_transaction = models.PixTransaction(
            charge_id=transaction_data.charge_id,
            sender_info=transaction_data.sender_info,
            recipient_key_id=recipient_key.id,
            amount=transaction_data.amount,
            transaction_id=transaction_data.transaction_id,
            status=models.PixTransactionStatus.COMPLETED,
            completed_at=datetime.now()
        )

        try:
            self.db.begin_nested() # Start a nested transaction for atomicity

            # 1. Add the new transaction
            self.db.add(db_transaction)

            # 2. Update the associated charge status if a charge_id is provided
            if transaction_data.charge_id:
                db_charge = self.get_pix_charge(transaction_data.charge_id)

                if db_charge.status == models.PixChargeStatus.PAID:
                    self.db.rollback()
                    raise PixTransactionAlreadyProcessedError(db_charge.id)

                if db_charge.expires_at < datetime.now():
                    self.db.rollback()
                    raise PixChargeExpiredError(db_charge.id)

                # Basic validation: check if the paid amount matches the charge amount
                if abs(db_charge.amount - transaction_data.amount) > 0.01:
                    logger.warning(f"Amount mismatch for charge {db_charge.id}: Expected {db_charge.amount}, Received {transaction_data.amount}")
                    # In a real system, this might lead to a manual review or refund
                    # For now, we'll process it but log the warning.

                db_charge.status = models.PixChargeStatus.PAID
                logger.info(f"Updated PIX charge ID {db_charge.id} to PAID.")

            self.db.commit()
            self.db.refresh(db_transaction)
            logger.info(f"Successfully processed incoming PIX transaction: {db_transaction.transaction_id}")
            return db_transaction

        except Exception as e:
            self.db.rollback()
            logger.error(f"Failed to process incoming transaction {transaction_data.transaction_id}: {e}")
            # Re-raise the custom exception or a generic one if it's a DB error
            if isinstance(e, PixIntegrationError):
                raise e
            raise PixIntegrationError(name="TransactionProcessingError", message="An unexpected error occurred during transaction processing.")

    def get_transaction_by_id(self, transaction_id: int) -> models.PixTransaction:
        """Retrieves a PIX transaction by its internal ID."""
        db_transaction = self.db.query(models.PixTransaction).filter(models.PixTransaction.id == transaction_id).first()
        if not db_transaction:
            raise PixIntegrationError(
                name="PixTransactionNotFoundError",
                message=f"PIX Transaction with ID '{transaction_id}' not found.",
                status_code=status.HTTP_404_NOT_FOUND
            )
        return db_transaction

# Dependency to get the service instance
def get_pix_service(db: Session) -> PixService:
    return PixService(db)
