from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from . import schemas, service
from .database import get_db

router = APIRouter(
    prefix="/messages",
    tags=["messages"],
    responses={404: {"description": "Not found"}},
)

# --- Error Handling Helper ---

def handle_service_exception(e: service.ServiceException):
    """Converts a service exception into an appropriate HTTP exception."""
    raise HTTPException(
        status_code=e.status_code,
        detail=e.message
    )

# --- CRUD Operations ---

@router.post(
    "/",
    response_model=schemas.MessageResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new message entry (PENDING status)"
)
def create_message(message_in: schemas.MessageCreate, db: Session = Depends(get_db)):
    """
    Creates a new message record in the database with a PENDING status.
    The message is not produced to Kafka until the /produce endpoint is called.
    """
    try:
        return service.create_message(db=db, message_in=message_in)
    except service.ServiceException as e:
        handle_service_exception(e)

@router.get(
    "/",
    response_model=List[schemas.MessageResponse],
    summary="List all message entries with pagination"
)
def read_messages(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    Retrieves a list of all message records from the database.
    """
    try:
        messages = service.get_messages(db, skip=skip, limit=limit)
        return messages
    except service.ServiceException as e:
        handle_service_exception(e)

@router.get(
    "/{message_id}",
    response_model=schemas.MessageResponse,
    summary="Get a single message entry by ID"
)
def read_message(message_id: int, db: Session = Depends(get_db)):
    """
    Retrieves a single message record by its ID.
    """
    try:
        message = service.get_message(db, message_id=message_id)
        return message
    except service.NotFoundException as e:
        handle_service_exception(e)
    except service.ServiceException as e:
        handle_service_exception(e)

@router.post(
    "/{message_id}/produce",
    response_model=schemas.MessageResponse,
    summary="Produce a PENDING message to Kafka"
)
async def produce_message(message_id: int, db: Session = Depends(get_db)):
    """
    Attempts to produce the specified message (which must be PENDING) to the configured Kafka cluster.
    The database record is updated to PRODUCED or FAILED based on the result.
    """
    try:
        # The service function is marked async, so we await it here.
        # It will run in FastAPI's default threadpool since the underlying Kafka client is synchronous.
        message = await service.produce_message_to_kafka(db, message_id=message_id)
        return message
    except service.NotFoundException as e:
        handle_service_exception(e)
    except service.KafkaProductionException as e:
        # Specifically handle Kafka production failures, which update the DB to FAILED
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=e.message
        )
    except service.ServiceException as e:
        handle_service_exception(e)

@router.delete(
    "/{message_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a message entry by ID"
)
def delete_message(message_id: int, db: Session = Depends(get_db)):
    """
    Deletes a message record from the database.
    """
    try:
        service.delete_message(db, message_id=message_id)
        return status.HTTP_204_NO_CONTENT
    except service.NotFoundException as e:
        handle_service_exception(e)
    except service.ServiceException as e:
        handle_service_exception(e)