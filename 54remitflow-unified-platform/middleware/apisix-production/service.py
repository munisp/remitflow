import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from models import ApisixRoute
from schemas import ApisixRouteCreate, ApisixRouteUpdate

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Custom Exceptions ---

class NotFoundError(Exception):
    """Raised when a requested resource is not found."""
    def __init__(self, resource_id: str):
        self.resource_id = resource_id
        super().__init__(f"Resource with ID or Name '{resource_id}' not found.")

class ConflictError(Exception):
    """Raised when a resource with the same unique identifier already exists."""
    def __init__(self, resource_name: str):
        self.resource_name = resource_name
        super().__init__(f"Resource with name '{resource_name}' already exists.")

# --- Service Layer ---

class ApisixRouteService:
    """
    Service layer for managing APISIX Route entities.
    Handles business logic, database interaction, and error handling.
    """

    def __init__(self, db: Session):
        self.db = db

    def create_route(self, route_in: ApisixRouteCreate) -> ApisixRoute:
        """Creates a new APISIX Route."""
        logger.info(f"Attempting to create new route: {route_in.name}")
        
        # Check for existing route with the same name
        existing_route = self.db.query(ApisixRoute).filter(ApisixRoute.name == route_in.name).first()
        if existing_route:
            raise ConflictError(route_in.name)

        db_route = ApisixRoute(**route_in.model_dump())
        
        try:
            self.db.add(db_route)
            self.db.commit()
            self.db.refresh(db_route)
            logger.info(f"Successfully created route with ID: {db_route.id}")
            return db_route
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Integrity error during route creation: {e}")
            raise ConflictError(route_in.name) from e
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during route creation: {e}")
            raise

    def get_route(self, route_id: UUID) -> ApisixRoute:
        """Retrieves a single APISIX Route by ID."""
        logger.info(f"Attempting to retrieve route with ID: {route_id}")
        route = self.db.query(ApisixRoute).filter(ApisixRoute.id == route_id).first()
        if not route:
            raise NotFoundError(str(route_id))
        return route

    def get_routes(self, skip: int = 0, limit: int = 100) -> List[ApisixRoute]:
        """Retrieves a list of APISIX Routes."""
        logger.info(f"Retrieving routes with skip={skip}, limit={limit}")
        return self.db.query(ApisixRoute).offset(skip).limit(limit).all()

    def update_route(self, route_id: UUID, route_in: ApisixRouteUpdate) -> ApisixRoute:
        """Updates an existing APISIX Route."""
        logger.info(f"Attempting to update route with ID: {route_id}")
        db_route = self.get_route(route_id) # Uses get_route, which raises NotFoundError if not found

        update_data = route_in.model_dump(exclude_unset=True)
        
        # Check for name conflict if the name is being updated
        if "name" in update_data and update_data["name"] != db_route.name:
            existing_route = self.db.query(ApisixRoute).filter(ApisixRoute.name == update_data["name"]).first()
            if existing_route and existing_route.id != route_id:
                raise ConflictError(update_data["name"])

        for key, value in update_data.items():
            setattr(db_route, key, value)

        try:
            self.db.add(db_route)
            self.db.commit()
            self.db.refresh(db_route)
            logger.info(f"Successfully updated route with ID: {route_id}")
            return db_route
        except IntegrityError as e:
            self.db.rollback()
            logger.error(f"Integrity error during route update: {e}")
            # Re-check for name conflict if the error is due to the unique constraint on name
            if "name" in update_data:
                raise ConflictError(update_data["name"]) from e
            raise
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during route update: {e}")
            raise

    def delete_route(self, route_id: UUID) -> None:
        """Deletes an APISIX Route by ID."""
        logger.info(f"Attempting to delete route with ID: {route_id}")
        db_route = self.get_route(route_id) # Uses get_route, which raises NotFoundError if not found
        
        try:
            self.db.delete(db_route)
            self.db.commit()
            logger.info(f"Successfully deleted route with ID: {route_id}")
        except Exception as e:
            self.db.rollback()
            logger.error(f"Unexpected error during route deletion: {e}")
            raise