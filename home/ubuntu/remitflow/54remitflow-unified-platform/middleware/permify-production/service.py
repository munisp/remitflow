from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, update
from sqlalchemy.exc import IntegrityError
from typing import List, Optional, Union, Any
import logging
import json

from models import RelationalTuple, Attribute
from schemas import (
    RelationalTupleCreate, RelationalTupleUpdate, RelationalTupleInDB,
    AttributeCreate, AttributeUpdate, AttributeInDB,
    TupleFilter, AttributeFilter
)

logger = logging.getLogger(__name__)

# --- Custom Exceptions ---

class ServiceException(Exception):
    """Base exception for service layer errors."""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)

class NotFoundException(ServiceException):
    """Raised when a requested resource is not found."""
    def __init__(self, resource_name: str, identifier: Any):
        super().__init__(f"{resource_name} with identifier '{identifier}' not found.", status_code=404)

class AlreadyExistsException(ServiceException):
    """Raised when trying to create a resource that already exists."""
    def __init__(self, resource_name: str, identifier: Any):
        super().__init__(f"{resource_name} with identifier '{identifier}' already exists.", status_code=409)

class InvalidDataException(ServiceException):
    """Raised when input data is invalid or cannot be processed."""
    def __init__(self, message: str):
        super().__init__(message, status_code=400)

# --- Utility Functions ---

def _serialize_attribute_value(value: Any, value_type: str) -> str:
    """Converts a Pydantic attribute value to a string for database storage."""
    if value_type == 'string[]':
        return json.dumps(value)
    elif value_type == 'boolean':
        return "true" if value else "false"
    return str(value)

def _deserialize_attribute_value(value: str, value_type: str) -> Any:
    """Converts a database string value back to its Python type."""
    if value_type == 'string[]':
        return json.loads(value)
    elif value_type == 'boolean':
        return value.lower() == 'true'
    elif value_type == 'integer':
        return int(value)
    elif value_type == 'double':
        return float(value)
    return value

# --- Relational Tuple Service ---

class RelationalTupleService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.resource_name = "Relational Tuple"

    def _get_tuple_identifier(self, tuple_data: Union[RelationalTupleCreate, RelationalTuple]) -> str:
        """Generates a unique string identifier for a tuple."""
        if isinstance(tuple_data, RelationalTupleCreate):
            e = tuple_data.entity
            s = tuple_data.subject
            return f"{e.type}:{e.id}#{tuple_data.relation}@{s.type}:{s.id}#{s.relation or '...'}"
        elif isinstance(tuple_data, RelationalTuple):
            return f"{tuple_data.entity_type}:{tuple_data.entity_id}#{tuple_data.relation}@{tuple_data.subject_type}:{tuple_data.subject_id}#{tuple_data.subject_relation or '...'}"
        return "Unknown"

    async def create_tuple(self, tuple_data: RelationalTupleCreate) -> RelationalTuple:
        """Creates a new relational tuple, ensuring uniqueness."""
        identifier = self._get_tuple_identifier(tuple_data)
        logger.info(f"Attempting to create {self.resource_name}: {identifier}")

        # Check for existing tuple using the unique constraint fields
        existing_tuple = await self.db.scalar(
            select(RelationalTuple).where(
                RelationalTuple.entity_type == tuple_data.entity.type,
                RelationalTuple.entity_id == tuple_data.entity.id,
                RelationalTuple.relation == tuple_data.relation,
                RelationalTuple.subject_type == tuple_data.subject.type,
                RelationalTuple.subject_id == tuple_data.subject.id,
                RelationalTuple.subject_relation == (tuple_data.subject.relation or "")
            )
        )

        if existing_tuple:
            raise AlreadyExistsException(self.resource_name, identifier)

        new_tuple = RelationalTuple(
            entity_type=tuple_data.entity.type,
            entity_id=tuple_data.entity.id,
            relation=tuple_data.relation,
            subject_type=tuple_data.subject.type,
            subject_id=tuple_data.subject.id,
            subject_relation=(tuple_data.subject.relation or "")
        )

        self.db.add(new_tuple)
        try:
            await self.db.commit()
            await self.db.refresh(new_tuple)
            logger.info(f"Successfully created {self.resource_name}: {identifier}")
            return new_tuple
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error creating {self.resource_name} {identifier}: {e}")
            raise AlreadyExistsException(self.resource_name, identifier)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error creating {self.resource_name} {identifier}: {e}")
            raise ServiceException(f"Failed to create {self.resource_name}")

    async def get_tuple(self, tuple_id: int) -> RelationalTuple:
        """Retrieves a relational tuple by its ID."""
        tuple_obj = await self.db.get(RelationalTuple, tuple_id)
        if not tuple_obj:
            raise NotFoundException(self.resource_name, tuple_id)
        return tuple_obj

    async def list_tuples(self, filters: TupleFilter) -> List[RelationalTuple]:
        """Lists relational tuples based on filters."""
        logger.info(f"Listing {self.resource_name} with filters: {filters.model_dump()}")
        
        stmt = select(RelationalTuple)
        
        if filters.entity_type:
            stmt = stmt.where(RelationalTuple.entity_type == filters.entity_type)
        if filters.entity_id:
            stmt = stmt.where(RelationalTuple.entity_id == filters.entity_id)
        if filters.relation:
            stmt = stmt.where(RelationalTuple.relation == filters.relation)
        if filters.subject_type:
            stmt = stmt.where(RelationalTuple.subject_type == filters.subject_type)
        if filters.subject_id:
            stmt = stmt.where(RelationalTuple.subject_id == filters.subject_id)
        if filters.subject_relation:
            stmt = stmt.where(RelationalTuple.subject_relation == filters.subject_relation)
        
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def delete_tuple(self, tuple_id: int) -> None:
        """Deletes a relational tuple by its ID."""
        logger.info(f"Attempting to delete {self.resource_name} with ID: {tuple_id}")
        
        # Check if it exists first
        tuple_obj = await self.get_tuple(tuple_id)
        
        stmt = delete(RelationalTuple).where(RelationalTuple.id == tuple_id)
        
        try:
            await self.db.execute(stmt)
            await self.db.commit()
            logger.info(f"Successfully deleted {self.resource_name} with ID: {tuple_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting {self.resource_name} {tuple_id}: {e}")
            raise ServiceException(f"Failed to delete {self.resource_name}")

# --- Attribute Service ---

class AttributeService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.resource_name = "Attribute"

    def _get_attribute_identifier(self, attribute_data: Union[AttributeCreate, Attribute]) -> str:
        """Generates a unique string identifier for an attribute."""
        if isinstance(attribute_data, AttributeCreate):
            e = attribute_data.entity
            return f"{e.type}:{e.id}${attribute_data.attribute_name}"
        elif isinstance(attribute_data, Attribute):
            return f"{attribute_data.entity_type}:{attribute_data.entity_id}${attribute_data.attribute_name}"
        return "Unknown"

    async def create_attribute(self, attribute_data: AttributeCreate) -> Attribute:
        """Creates a new attribute, ensuring uniqueness by entity and name."""
        identifier = self._get_attribute_identifier(attribute_data)
        logger.info(f"Attempting to create {self.resource_name}: {identifier}")

        # Check for existing attribute using the unique constraint fields
        existing_attribute = await self.db.scalar(
            select(Attribute).where(
                Attribute.entity_type == attribute_data.entity.type,
                Attribute.entity_id == attribute_data.entity.id,
                Attribute.attribute_name == attribute_data.attribute_name
            )
        )

        if existing_attribute:
            raise AlreadyExistsException(self.resource_name, identifier)

        new_attribute = Attribute(
            entity_type=attribute_data.entity.type,
            entity_id=attribute_data.entity.id,
            attribute_name=attribute_data.attribute_name,
            attribute_type=attribute_data.attribute_type,
            attribute_value=_serialize_attribute_value(attribute_data.attribute_value, attribute_data.attribute_type)
        )

        self.db.add(new_attribute)
        try:
            await self.db.commit()
            await self.db.refresh(new_attribute)
            logger.info(f"Successfully created {self.resource_name}: {identifier}")
            return new_attribute
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error creating {self.resource_name} {identifier}: {e}")
            raise AlreadyExistsException(self.resource_name, identifier)
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error creating {self.resource_name} {identifier}: {e}")
            raise ServiceException(f"Failed to create {self.resource_name}")

    async def get_attribute(self, attribute_id: int) -> Attribute:
        """Retrieves an attribute by its ID."""
        attribute_obj = await self.db.get(Attribute, attribute_id)
        if not attribute_obj:
            raise NotFoundException(self.resource_name, attribute_id)
        return attribute_obj

    async def list_attributes(self, filters: AttributeFilter) -> List[Attribute]:
        """Lists attributes based on filters."""
        logger.info(f"Listing {self.resource_name} with filters: {filters.model_dump()}")
        
        stmt = select(Attribute)
        
        if filters.entity_type:
            stmt = stmt.where(Attribute.entity_type == filters.entity_type)
        if filters.entity_id:
            stmt = stmt.where(Attribute.entity_id == filters.entity_id)
        if filters.attribute_name:
            stmt = stmt.where(Attribute.attribute_name == filters.attribute_name)
        if filters.attribute_type:
            stmt = stmt.where(Attribute.attribute_type == filters.attribute_type)
        if filters.attribute_value:
            # Filter on the stored string value
            stmt = stmt.where(Attribute.attribute_value == filters.attribute_value)
        
        result = await self.db.execute(stmt)
        return result.scalars().all()

    async def update_attribute(self, attribute_id: int, attribute_data: AttributeUpdate) -> Attribute:
        """Updates an existing attribute."""
        logger.info(f"Attempting to update {self.resource_name} with ID: {attribute_id}")
        
        # 1. Check if it exists
        existing_attribute = await self.get_attribute(attribute_id)
        
        # 2. Prepare update data
        update_data = {
            "entity_type": attribute_data.entity.type,
            "entity_id": attribute_data.entity.id,
            "attribute_name": attribute_data.attribute_name,
            "attribute_type": attribute_data.attribute_type,
            "attribute_value": _serialize_attribute_value(attribute_data.attribute_value, attribute_data.attribute_type)
        }
        
        # 3. Perform update
        stmt = update(Attribute).where(Attribute.id == attribute_id).values(**update_data)
        
        try:
            await self.db.execute(stmt)
            await self.db.commit()
            await self.db.refresh(existing_attribute)
            logger.info(f"Successfully updated {self.resource_name} with ID: {attribute_id}")
            return existing_attribute
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error updating {self.resource_name} {attribute_id}: {e}")
            raise ServiceException(f"Failed to update {self.resource_name}")

    async def delete_attribute(self, attribute_id: int) -> None:
        """Deletes an attribute by its ID."""
        logger.info(f"Attempting to delete {self.resource_name} with ID: {attribute_id}")
        
        # Check if it exists first
        attribute_obj = await self.get_attribute(attribute_id)
        
        stmt = delete(Attribute).where(Attribute.id == attribute_id)
        
        try:
            await self.db.execute(stmt)
            await self.db.commit()
            logger.info(f"Successfully deleted {self.resource_name} with ID: {attribute_id}")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Error deleting {self.resource_name} {attribute_id}: {e}")
            raise ServiceException(f"Failed to delete {self.resource_name}")