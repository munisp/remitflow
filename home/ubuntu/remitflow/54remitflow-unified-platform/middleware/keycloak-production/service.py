import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, update, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import KeycloakClientConfig, ProtectedResource
from .schemas import (
    KeycloakClientConfigCreate,
    KeycloakClientConfigUpdate,
    ProtectedResourceCreate,
    ProtectedResourceUpdate,
)

# Configure logging
logger = logging.getLogger(__name__)

# --- Custom Exceptions ---

class ServiceException(Exception):
    """Base exception for service layer errors."""
    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class NotFoundException(ServiceException):
    """Raised when a requested resource is not found."""
    def __init__(self, resource_name: str, identifier: str):
        message = f"{resource_name} with identifier '{identifier}' not found."
        super().__init__(message, status_code=404)

class ConflictException(ServiceException):
    """Raised when a resource creation or update violates a unique constraint."""
    def __init__(self, message: str):
        super().__init__(message, status_code=409)

# --- Service Implementation ---

class KeycloakProductionService:
    def __init__(self, db_session: AsyncSession):
        self.db = db_session

    # --- KeycloakClientConfig CRUD ---

    async def create_config(self, config_data: KeycloakClientConfigCreate) -> KeycloakClientConfig:
        """Creates a new KeycloakClientConfig and associated ProtectedResources."""
        try:
            # 1. Create the main config object
            config_dict = config_data.model_dump(exclude={"protected_resources"})
            new_config = KeycloakClientConfig(**config_dict)
            self.db.add(new_config)
            await self.db.flush() # Flush to get the ID for related resources

            # 2. Create associated protected resources
            if config_data.protected_resources:
                for resource_data in config_data.protected_resources:
                    resource_dict = resource_data.model_dump()
                    new_resource = ProtectedResource(
                        **resource_dict,
                        client_config_id=new_config.id
                    )
                    self.db.add(new_resource)

            await self.db.commit()
            logger.info(f"Created KeycloakClientConfig: {new_config.client_id}")
            return new_config
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error during config creation: {e}")
            raise ConflictException(f"Client config with client_id '{config_data.client_id}' already exists or a resource name is duplicated.")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error during config creation: {e}")
            raise ServiceException(f"Failed to create client config: {e}")

    async def get_config(self, config_id: UUID) -> KeycloakClientConfig:
        """Retrieves a KeycloakClientConfig by ID."""
        stmt = select(KeycloakClientConfig).where(KeycloakClientConfig.id == config_id)
        result = await self.db.execute(stmt)
        config = result.scalars().first()
        if not config:
            raise NotFoundException("KeycloakClientConfig", str(config_id))
        return config

    async def list_configs(self, skip: int = 0, limit: int = 100) -> List[KeycloakClientConfig]:
        """Lists all KeycloakClientConfigs."""
        stmt = select(KeycloakClientConfig).offset(skip).limit(limit)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def update_config(self, config_id: UUID, config_data: KeycloakClientConfigUpdate) -> KeycloakClientConfig:
        """Updates an existing KeycloakClientConfig."""
        config = await self.get_config(config_id) # Checks for existence
        
        update_data = config_data.model_dump(exclude_unset=True)
        if not update_data:
            return config # No update needed

        try:
            stmt = (
                update(KeycloakClientConfig)
                .where(KeycloakClientConfig.id == config_id)
                .values(**update_data)
                .returning(KeycloakClientConfig)
            )
            await self.db.execute(stmt)
            await self.db.commit()
            await self.db.refresh(config)
            logger.info(f"Updated KeycloakClientConfig: {config.client_id}")
            return config
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error during config update: {e}")
            raise ConflictException("Update failed due to a unique constraint violation (e.g., duplicate client_id).")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error during config update: {e}")
            raise ServiceException(f"Failed to update client config: {e}")

    async def delete_config(self, config_id: UUID) -> None:
        """Deletes a KeycloakClientConfig and all associated ProtectedResources."""
        stmt = delete(KeycloakClientConfig).where(KeycloakClientConfig.id == config_id)
        result = await self.db.execute(stmt)
        if result.rowcount == 0:
            raise NotFoundException("KeycloakClientConfig", str(config_id))
        await self.db.commit()
        logger.info(f"Deleted KeycloakClientConfig with ID: {config_id}")

    # --- ProtectedResource CRUD ---

    async def create_resource(self, config_id: UUID, resource_data: ProtectedResourceCreate) -> ProtectedResource:
        """Creates a new ProtectedResource for a given KeycloakClientConfig."""
        # Check if the parent config exists
        await self.get_config(config_id)

        try:
            resource_dict = resource_data.model_dump()
            new_resource = ProtectedResource(
                **resource_dict,
                client_config_id=config_id
            )
            self.db.add(new_resource)
            await self.db.commit()
            logger.info(f"Created ProtectedResource: {new_resource.resource_name} for config {config_id}")
            return new_resource
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error during resource creation: {e}")
            raise ConflictException(f"Resource name '{resource_data.resource_name}' already exists for client config '{config_id}'.")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error during resource creation: {e}")
            raise ServiceException(f"Failed to create protected resource: {e}")

    async def get_resource(self, resource_id: UUID) -> ProtectedResource:
        """Retrieves a ProtectedResource by ID."""
        stmt = select(ProtectedResource).where(ProtectedResource.id == resource_id)
        result = await self.db.execute(stmt)
        resource = result.scalars().first()
        if not resource:
            raise NotFoundException("ProtectedResource", str(resource_id))
        return resource

    async def list_resources(self, config_id: UUID, skip: int = 0, limit: int = 100) -> List[ProtectedResource]:
        """Lists all ProtectedResources for a given KeycloakClientConfig."""
        # Check if the parent config exists
        await self.get_config(config_id)
        
        stmt = (
            select(ProtectedResource)
            .where(ProtectedResource.client_config_id == config_id)
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def update_resource(self, resource_id: UUID, resource_data: ProtectedResourceUpdate) -> ProtectedResource:
        """Updates an existing ProtectedResource."""
        resource = await self.get_resource(resource_id) # Checks for existence
        
        update_data = resource_data.model_dump(exclude_unset=True)
        if not update_data:
            return resource # No update needed

        try:
            stmt = (
                update(ProtectedResource)
                .where(ProtectedResource.id == resource_id)
                .values(**update_data)
                .returning(ProtectedResource)
            )
            await self.db.execute(stmt)
            await self.db.commit()
            await self.db.refresh(resource)
            logger.info(f"Updated ProtectedResource: {resource.resource_name}")
            return resource
        except IntegrityError as e:
            await self.db.rollback()
            logger.error(f"Integrity error during resource update: {e}")
            raise ConflictException("Update failed due to a unique constraint violation (e.g., duplicate resource_name for the client).")
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Unexpected error during resource update: {e}")
            raise ServiceException(f"Failed to update protected resource: {e}")

    async def delete_resource(self, resource_id: UUID) -> None:
        """Deletes a ProtectedResource."""
        stmt = delete(ProtectedResource).where(ProtectedResource.id == resource_id)
        result = await self.db.execute(stmt)
        if result.rowcount == 0:
            raise NotFoundException("ProtectedResource", str(resource_id))
        await self.db.commit()
        logger.info(f"Deleted ProtectedResource with ID: {resource_id}")