import logging
import json
from typing import List, Optional
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from kafka import KafkaProducer
from kafka.errors import KafkaError

from . import models, schemas
from .config import settings

# Setup logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(settings.SERVICE_NAME)

# --- Custom Exceptions ---

class ServiceException(Exception):
    """Base exception for the service layer."""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class NotFoundException(ServiceException):
    """Exception raised when a resource is not found."""
    def __init__(self, resource_id: int):
        super().__init__(f"Message with ID {resource_id} not found.", status_code=404)

class KafkaProductionException(ServiceException):
    """Exception raised when Kafka production fails."""
    def __init__(self, topic: str, error: str):
        super().__init__(f"Failed to produce message to topic '{topic}'. Error: {error}", status_code=500)

# --- Kafka Producer Setup ---

def get_kafka_producer() -> KafkaProducer:
    """Initializes and returns a KafkaProducer instance."""
    try:
        producer = KafkaProducer(
            bootstrap_servers=settings.KAFKA_BOOTSTRAP_SERVERS.split(','),
            client_id=settings.KAFKA_CLIENT_ID,
            acks=settings.KAFKA_ACKS,
            value_serializer=lambda v: json.dumps(v).encode('utf-8'),
            key_serializer=lambda k: str(k).encode('utf-8') if k else None,
            api_version=(0, 10, 1), # Recommended for modern Kafka
            request_timeout_ms=settings.KAFKA_TIMEOUT_MS
        )
        logger.info("Kafka Producer initialized successfully.")
        return producer
    except Exception as e:
        logger.error(f"Failed to initialize Kafka Producer: {e}")
        # In a real-world scenario, you might want to handle this more gracefully
        # or ensure the application doesn't start without a producer.
        raise ServiceException(f"Kafka Producer initialization failed: {e}")

# Global producer instance (can be managed by FastAPI lifespan events for better control)
KAFKA_PRODUCER = get_kafka_producer()

# --- Business Logic ---

def create_message(db: Session, message_in: schemas.MessageCreate) -> models.Message:
    """
    Creates a new message record in the database with PENDING status.
    """
    logger.info(f"Attempting to create message for topic: {message_in.topic}")
    try:
        # Convert Pydantic model to a dictionary for SQLAlchemy model creation
        db_message = models.Message(
            topic=message_in.topic,
            key=message_in.key,
            # Store the value as a JSON string in the database
            value=json.dumps(message_in.value),
            status="PENDING"
        )
        db.add(db_message)
        db.commit()
        db.refresh(db_message)
        logger.info(f"Message ID {db_message.id} created successfully.")
        return db_message
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Integrity error creating message: {e}")
        raise ServiceException("A database integrity error occurred.", status_code=400)
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error creating message: {e}")
        raise ServiceException("A database error occurred.")

async def produce_message_to_kafka(db: Session, message_id: int) -> models.Message:
    """
    Retrieves a message from the database and attempts to produce it to Kafka.
    Updates the database record with the result.
    NOTE: The Kafka client used here is synchronous. For a truly non-blocking FastAPI app,
    an async client (like aiokafka) or running the production in a background task/threadpool
    is recommended. For this example, we'll use a simple synchronous approach and rely on
    FastAPI's default threadpool for the route handler.
    """
    db_message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not db_message:
        raise NotFoundException(message_id)

    if db_message.status != "PENDING":
        logger.warning(f"Message ID {message_id} is already {db_message.status}. Skipping production.")
        return db_message

    logger.info(f"Attempting to produce message ID {message_id} to topic {db_message.topic}")
    try:
        # The value is stored as a JSON string, so we need to load it back to a Python object
        payload = json.loads(db_message.value)
        
        # Send the message. The send method is asynchronous but returns a Future.
        # Calling .get() makes it block until the send is complete.
        future = KAFKA_PRODUCER.send(
            topic=db_message.topic,
            value=payload,
            key=db_message.key
        )
        
        # Block for acknowledgement
        record_metadata = future.get(timeout=settings.KAFKA_TIMEOUT_MS / 1000)
        
        # Success: Update database record
        db_message.status = "PRODUCED"
        db_message.produced_at = datetime.now()
        db_message.error_message = None
        db.commit()
        db.refresh(db_message)
        
        logger.info(f"Message ID {message_id} successfully produced to topic {record_metadata.topic} partition {record_metadata.partition} offset {record_metadata.offset}")
        return db_message

    except KafkaError as e:
        # Failure: Update database record with error
        db_message.status = "FAILED"
        db_message.error_message = str(e)
        db.commit()
        db.refresh(db_message)
        logger.error(f"Kafka production failed for message ID {message_id}: {e}")
        raise KafkaProductionException(db_message.topic, str(e))
    except Exception as e:
        # General failure: Update database record with error
        db_message.status = "FAILED"
        db_message.error_message = f"Unexpected error: {str(e)}"
        db.commit()
        db.refresh(db_message)
        logger.error(f"Unexpected error during production for message ID {message_id}: {e}")
        raise ServiceException(f"Unexpected error during production: {e}")

def get_message(db: Session, message_id: int) -> models.Message:
    """
    Retrieves a single message by ID.
    """
    db_message = db.query(models.Message).filter(models.Message.id == message_id).first()
    if not db_message:
        raise NotFoundException(message_id)
    return db_message

def get_messages(db: Session, skip: int = 0, limit: int = 100) -> List[models.Message]:
    """
    Retrieves a list of messages with pagination.
    """
    return db.query(models.Message).offset(skip).limit(limit).all()

def delete_message(db: Session, message_id: int) -> models.Message:
    """
    Deletes a message by ID.
    """
    db_message = get_message(db, message_id) # Uses get_message for existence check
    
    logger.info(f"Attempting to delete message ID {message_id}")
    try:
        db.delete(db_message)
        db.commit()
        logger.info(f"Message ID {message_id} deleted successfully.")
        return db_message
    except SQLAlchemyError as e:
        db.rollback()
        logger.error(f"Database error deleting message ID {message_id}: {e}")
        raise ServiceException("A database error occurred during deletion.")

# CRUD operations are now complete:
# Create: create_message
# Read (single): get_message
# Read (list): get_messages
# Update: produce_message_to_kafka (This acts as the primary update operation)
# Delete: delete_message