import logging
from typing import List, Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from .database import get_db
from .service import KeycloakProductionService, NotFoundException, ConflictException, ServiceException
from .schemas import (
    KeycloakClientConfig,
    KeycloakClientConfigCreate,
    KeycloakClientConfigUpdate,
    ProtectedResource,
    ProtectedResourceCreate,
    ProtectedResourceUpdate,
    ListResponse,
    ProtectedResourceListResponse,
    SuccessResponse,
)

# Configure logging
logger = logging.getLogger(__name__)

# --- Security Dependency (Placeholder for Keycloak JWT Validation) ---

# In a real application, this dependency would use a library like python-keycloak
# or a custom implementation to validate the JWT token from the Authorization header
# against the Keycloak server's public key and check for required roles/scopes.
# For this implementation, we use a simple placeholder.
async def get_current_user():
    """Placeholder for Keycloak JWT validation and user extraction."""
    # Simulate a successful authentication/authorization check
    # In a real app, this would raise HTTPException(401) or (403) on failure
    return {"username": "admin_user", "roles": ["keycloak-admin"]}

# --- Dependency for Service Layer ---

async def get_service(db: Annotated[AsyncSession, Depends(get_db)]) -> KeycloakProductionService:
    """Dependency that provides the KeycloakProductionService instance."""
    return KeycloakProductionService(db)

# --- Router Setup ---

router = APIRouter(
    prefix="/v1/keycloak-configs",
    tags=["Keycloak Configurations"],
    dependencies=[Depends(get_current_user)], # Apply security to all routes
)

# --- KeycloakClientConfig Endpoints ---

@router.post(
    "/", 
    response_model=KeycloakClientConfig, 
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Keycloak Client Configuration"
)
async def create_config(
    config_data: KeycloakClientConfigCreate,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """
    Creates a new Keycloak Client Configuration entry.
    Optionally includes a list of Protected Resources to be created simultaneously.
    """
    try:
        return await service.create_config(config_data)
    except ConflictException as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@router.get(
    "/", 
    response_model=ListResponse,
    summary="List all Keycloak Client Configurations"
)
async def list_configs(
    service: Annotated[KeycloakProductionService, Depends(get_service)],
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """Retrieves a list of all Keycloak Client Configurations."""
    configs = await service.list_configs(skip=skip, limit=limit)
    # In a real scenario, we'd fetch the total count separately for pagination metadata
    return ListResponse(total=len(configs), items=configs)

@router.get(
    "/{config_id}", 
    response_model=KeycloakClientConfig,
    summary="Get a Keycloak Client Configuration by ID"
)
async def get_config(
    config_id: UUID,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Retrieves a single Keycloak Client Configuration by its UUID."""
    try:
        return await service.get_config(config_id)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)

@router.put(
    "/{config_id}", 
    response_model=KeycloakClientConfig,
    summary="Update an existing Keycloak Client Configuration"
)
async def update_config(
    config_id: UUID,
    config_data: KeycloakClientConfigUpdate,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Updates an existing Keycloak Client Configuration by its UUID."""
    try:
        return await service.update_config(config_id, config_data)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except ConflictException as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@router.delete(
    "/{config_id}", 
    response_model=SuccessResponse,
    summary="Delete a Keycloak Client Configuration"
)
async def delete_config(
    config_id: UUID,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Deletes a Keycloak Client Configuration and all its associated Protected Resources."""
    try:
        await service.delete_config(config_id)
        return SuccessResponse(message=f"KeycloakClientConfig {config_id} and all associated resources deleted successfully.")
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)

# --- ProtectedResource Endpoints (Nested) ---

@router.post(
    "/{config_id}/resources", 
    response_model=ProtectedResource, 
    status_code=status.HTTP_201_CREATED,
    summary="Create a Protected Resource for a Client Configuration"
)
async def create_resource(
    config_id: UUID,
    resource_data: ProtectedResourceCreate,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Creates a new Protected Resource associated with a specific Keycloak Client Configuration."""
    try:
        return await service.create_resource(config_id, resource_data)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except ConflictException as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@router.get(
    "/{config_id}/resources", 
    response_model=ProtectedResourceListResponse,
    summary="List Protected Resources for a Client Configuration"
)
async def list_resources(
    config_id: UUID,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
):
    """Lists all Protected Resources for a specific Keycloak Client Configuration."""
    try:
        resources = await service.list_resources(config_id, skip=skip, limit=limit)
        return ProtectedResourceListResponse(total=len(resources), items=resources)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)

@router.get(
    "/resources/{resource_id}", 
    response_model=ProtectedResource,
    summary="Get a Protected Resource by ID"
)
async def get_resource(
    resource_id: UUID,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Retrieves a single Protected Resource by its UUID."""
    try:
        return await service.get_resource(resource_id)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)

@router.put(
    "/resources/{resource_id}", 
    response_model=ProtectedResource,
    summary="Update an existing Protected Resource"
)
async def update_resource(
    resource_id: UUID,
    resource_data: ProtectedResourceUpdate,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Updates an existing Protected Resource by its UUID."""
    try:
        return await service.update_resource(resource_id, resource_data)
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
    except ConflictException as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)

@router.delete(
    "/resources/{resource_id}", 
    response_model=SuccessResponse,
    summary="Delete a Protected Resource"
)
async def delete_resource(
    resource_id: UUID,
    service: Annotated[KeycloakProductionService, Depends(get_service)],
):
    """Deletes a Protected Resource by its UUID."""
    try:
        await service.delete_resource(resource_id)
        return SuccessResponse(message=f"ProtectedResource {resource_id} deleted successfully.")
    except NotFoundException as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)