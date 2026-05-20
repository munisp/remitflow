from typing import List
from uuid import UUID
from fastapi import APIRouter, Depends, status, Query
from sqlalchemy.orm import Session

from database import get_db
from schemas import Participant, ParticipantCreate, ParticipantUpdate
from service import ParticipantService

# Initialize the router
participant_router = APIRouter(
    prefix="/participants",
    tags=["Participants"],
)

# Dependency to get the service layer
def get_participant_service(db: Session = Depends(get_db)) -> ParticipantService:
    return ParticipantService(db)

@participant_router.post(
    "/",
    response_model=Participant,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Participant",
    description="Registers a new Financial Service Provider (FSP) as a Participant in the system."
)
def create_participant(
    participant_in: ParticipantCreate,
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Creates a new Participant with the provided details.
    Raises a 409 Conflict error if a Participant with the same FSP ID already exists.
    """
    return service.create(participant_in)

@participant_router.get(
    "/",
    response_model=List[Participant],
    summary="List all Participants",
    description="Retrieves a list of all registered Participants, with optional pagination."
)
def list_participants(
    skip: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(100, le=1000, description="Maximum number of items to return"),
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Returns a list of Participants.
    """
    return service.get_all(skip=skip, limit=limit)

@participant_router.get(
    "/{participant_id}",
    response_model=Participant,
    summary="Get Participant by ID",
    description="Retrieves a single Participant using its internal UUID."
)
def get_participant_by_id(
    participant_id: UUID,
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Returns the Participant matching the given UUID.
    Raises a 404 Not Found error if the Participant does not exist.
    """
    return service.get_by_id(participant_id)

@participant_router.get(
    "/fsp/{fsp_id}",
    response_model=Participant,
    summary="Get Participant by FSP ID",
    description="Retrieves a single Participant using its unique FSP Identifier."
)
def get_participant_by_fsp_id(
    fsp_id: str,
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Returns the Participant matching the given FSP ID.
    Raises a 404 Not Found error if the Participant does not exist.
    """
    return service.get_by_fsp_id(fsp_id)

@participant_router.patch(
    "/{participant_id}",
    response_model=Participant,
    summary="Update a Participant",
    description="Updates an existing Participant's details using its internal UUID."
)
def update_participant(
    participant_id: UUID,
    participant_in: ParticipantUpdate,
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Updates the Participant. Only provided fields will be modified.
    Raises a 404 Not Found error if the Participant does not exist.
    """
    return service.update(participant_id, participant_in)

@participant_router.delete(
    "/{participant_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Participant",
    description="Deletes a Participant using its internal UUID."
)
def delete_participant(
    participant_id: UUID,
    service: ParticipantService = Depends(get_participant_service)
):
    """
    Deletes the Participant.
    Raises a 404 Not Found error if the Participant does not exist.
    """
    service.delete(participant_id)
    return
