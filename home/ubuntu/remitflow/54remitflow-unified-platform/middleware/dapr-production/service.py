import logging
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from models import DaprComponent, DaprComponentMetadata
from schemas import DaprComponentCreate, DaprComponentUpdate, DaprComponentMetadataCreate

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Custom Exceptions ---

class ComponentServiceError(Exception):
    """Base exception for component service errors."""
    pass

class ComponentNotFoundError(ComponentServiceError):
    """Raised when a component is not found."""
    def __init__(self, component_id: int):
        self.component_id = component_id
        super().__init__(f"DaprComponent with ID {component_id} not found.")

class ComponentAlreadyExistsError(ComponentServiceError):
    """Raised when a component with the same name already exists."""
    def __init__(self, name: str):
        self.name = name
        super().__init__(f"DaprComponent with name '{name}' already exists.")

# --- Service Class ---

class DaprComponentService:
    """
    Service layer for managing DaprComponent resources.
    Handles business logic, database interactions, and error handling.
    """

    def __init__(self, db: Session):
        self.db = db

    def _create_metadata_items(self, component_id: int, metadata_list: List[DaprComponentMetadataCreate]) -> List[DaprComponentMetadata]:
        """Helper to create metadata items for a component."""
        metadata_objects = []
        for meta_data in metadata_list:
            meta_obj = DaprComponentMetadata(
                component_id=component_id,
                key=meta_data.key,
                value=meta_data.value,
                secret_ref=meta_data.secret_ref
            )
            self.db.add(meta_obj)
            metadata_objects.append(meta_obj)
        return metadata_objects

    def create_component(self, component_data: DaprComponentCreate) -> DaprComponent:
        """Creates a new Dapr component and its associated metadata."""
        logger.info(f"Attempting to create new component: {component_data.name}")

        # Check for existing component with the same name
        if self.db.query(DaprComponent).filter(DaprComponent.name == component_data.name).first():
            raise ComponentAlreadyExistsError(component_data.name)

        # Create the component object
        db_component = DaprComponent(
            name=component_data.name,
            component_type=component_data.component_type,
            version=component_data.version,
            scope=component_data.scope,
            is_production=component_data.is_production
        )

        try:
            self.db.add(db_component)
            self.db.flush() # Flush to get the component ID

            # Create associated metadata items
            self._create_metadata_items(db_component.id, component_data.metadata_items)

            self.db.commit()
            self.db.refresh(db_component)
            logger.info(f"Successfully created component with ID: {db_component.id}")
            return db_component
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Integrity error during component creation: {e}")
            # Re-raise as a more specific error if possible, or the generic base error
            if "dapr_components_name_key" in str(e):
                 raise ComponentAlreadyExistsError(component_data.name)
            raise ComponentServiceError(f"Database integrity error: {e}")
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during component creation: {e}")
            raise ComponentServiceError(f"Failed to create component: {e}")

    def get_component(self, component_id: int) -> DaprComponent:
        """Retrieves a Dapr component by its ID."""
        logger.info(f"Retrieving component with ID: {component_id}")
        component = self.db.query(DaprComponent).filter(DaprComponent.id == component_id).first()
        if not component:
            raise ComponentNotFoundError(component_id)
        return component

    def get_all_components(self, skip: int = 0, limit: int = 100) -> List[DaprComponent]:
        """Retrieves a list of Dapr components with pagination."""
        logger.info(f"Retrieving components with skip={skip}, limit={limit}")
        return self.db.query(DaprComponent).offset(skip).limit(limit).all()

    def update_component(self, component_id: int, component_data: DaprComponentUpdate) -> DaprComponent:
        """Updates an existing Dapr component and optionally replaces its metadata."""
        logger.info(f"Attempting to update component with ID: {component_id}")
        db_component = self.get_component(component_id) # Uses get_component for existence check

        # Check for name conflict if name is being updated
        if component_data.name and component_data.name != db_component.name:
            if self.db.query(DaprComponent).filter(DaprComponent.name == component_data.name).first():
                raise ComponentAlreadyExistsError(component_data.name)

        # Update scalar fields
        update_data = component_data.dict(exclude_unset=True, exclude={'metadata_items'})
        for key, value in update_data.items():
            setattr(db_component, key, value)

        # Handle metadata replacement if provided
        if component_data.metadata_items is not None:
            logger.info(f"Replacing metadata for component ID: {component_id}")
            # Delete existing metadata
            self.db.query(DaprComponentMetadata).filter(DaprComponentMetadata.component_id == component_id).delete()
            # Create new metadata
            self._create_metadata_items(component_id, component_data.metadata_items)

        try:
            self.db.add(db_component)
            self.db.commit()
            self.db.refresh(db_component)
            logger.info(f"Successfully updated component with ID: {component_id}")
            return db_component
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Integrity error during component update: {e}")
            raise ComponentServiceError(f"Database integrity error: {e}")
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during component update: {e}")
            raise ComponentServiceError(f"Failed to update component: {e}")

    def delete_component(self, component_id: int) -> None:
        """Deletes a Dapr component by its ID."""
        logger.info(f"Attempting to delete component with ID: {component_id}")
        db_component = self.get_component(component_id) # Uses get_component for existence check

        try:
            self.db.delete(db_component)
            self.db.commit()
            logger.info(f"Successfully deleted component with ID: {component_id}")
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during component deletion: {e}")
            raise ComponentServiceError(f"Failed to delete component: {e}")

# Dependency function for router
def get_component_service(db: Session) -> DaprComponentService:
    """Dependency that provides a DaprComponentService instance."""
    return DaprComponentService(db)