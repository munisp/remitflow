import logging
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import Participant
from schemas import ParticipantCreate, ParticipantUpdate
from exceptions import NotFoundException, ConflictException

logger = logging.getLogger(__name__)

class ParticipantService:
    """
    Business logic layer for managing Participant entities.
    Handles CRUD operations and ensures data integrity.
    """

    def __init__(self, db: Session):
        self.db = db

    def get_all(self, skip: int = 0, limit: int = 100) -> List[Participant]:
        """Retrieve a list of all Participants."""
        logger.info(f"Fetching all participants (skip={skip}, limit={limit})")
        return self.db.query(Participant).offset(skip).limit(limit).all()

    def get_by_id(self, participant_id: UUID) -> Participant:
        """Retrieve a single Participant by its internal UUID."""
        logger.info(f"Fetching participant with ID: {participant_id}")
        participant = self.db.query(Participant).filter(Participant.id == participant_id).first()
        if not participant:
            logger.warning(f"Participant with ID {participant_id} not found.")
            raise NotFoundException(resource_name="Participant")
        return participant

    def get_by_fsp_id(self, fsp_id: str) -> Participant:
        """Retrieve a single Participant by its unique FSP ID."""
        logger.info(f"Fetching participant with FSP ID: {fsp_id}")
        participant = self.db.query(Participant).filter(Participant.fsp_id == fsp_id).first()
        if not participant:
            logger.warning(f"Participant with FSP ID {fsp_id} not found.")
            raise NotFoundException(resource_name="Participant")
        return participant

    def create(self, participant_in: ParticipantCreate) -> Participant:
        """Create a new Participant."""
        logger.info(f"Attempting to create new participant with FSP ID: {participant_in.fsp_id}")

        # Check for existing FSP ID to prevent conflict
        existing_participant = self.db.query(Participant).filter(Participant.fsp_id == participant_in.fsp_id).first()
        if existing_participant:
            logger.error(f"Participant with FSP ID {participant_in.fsp_id} already exists.")
            raise ConflictException(resource_name="Participant")

        db_participant = Participant(**participant_in.model_dump())
        self.db.add(db_participant)
        try:
            self.db.commit()
            self.db.refresh(db_participant)
            logger.info(f"Successfully created participant with ID: {db_participant.id}")
            return db_participant
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Database integrity error during creation: {e}")
            # Re-raise as a more specific exception if needed, but ConflictException covers the unique constraint
            raise ConflictException(resource_name="Participant")

    def update(self, participant_id: UUID, participant_in: ParticipantUpdate) -> Participant:
        """Update an existing Participant."""
        logger.info(f"Attempting to update participant with ID: {participant_id}")
        db_participant = self.get_by_id(participant_id) # Uses get_by_id for existence check

        update_data = participant_in.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(db_participant, key, value)

        self.db.add(db_participant)
        self.db.commit()
        self.db.refresh(db_participant)
        logger.info(f"Successfully updated participant with ID: {participant_id}")
        return db_participant

    def delete(self, participant_id: UUID) -> None:
        """Delete a Participant."""
        logger.info(f"Attempting to delete participant with ID: {participant_id}")
        db_participant = self.get_by_id(participant_id) # Uses get_by_id for existence check

        self.db.delete(db_participant)
        self.db.commit()
        logger.info(f"Successfully deleted participant with ID: {participant_id}")
