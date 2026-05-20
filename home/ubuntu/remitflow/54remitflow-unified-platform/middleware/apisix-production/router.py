from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from schemas import ApisixRoute, ApisixRouteCreate, ApisixRouteUpdate
from service import ApisixRouteService, NotFoundError, ConflictError

router = APIRouter(
    prefix="/routes",
    tags=["APISIX Routes"],
    responses={404: {"description": "Not found"}},
)

# Dependency to get the service layer
def get_route_service(db: Session = Depends(get_db)) -> ApisixRouteService:
    """Provides the APISIX Route service instance."""
    return ApisixRouteService(db)

@router.post(
    "/", 
    response_model=ApisixRoute, 
    status_code=status.HTTP_201_CREATED,
    summary="Create a new APISIX Route",
    description="Creates a new APISIX Route configuration in the database."
)
def create_route(
    route_in: ApisixRouteCreate,
    service: ApisixRouteService = Depends(get_route_service)
):
    """
    Create a new APISIX Route with the provided details.
    Raises 409 Conflict if a route with the same name already exists.
    """
    try:
        return service.create_route(route_in)
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )

@router.get(
    "/", 
    response_model=List[ApisixRoute],
    summary="List all APISIX Routes",
    description="Retrieves a list of all configured APISIX Routes."
)
def read_routes(
    skip: int = 0, 
    limit: int = 100,
    service: ApisixRouteService = Depends(get_route_service)
):
    """
    Retrieve a list of APISIX Routes with optional pagination.
    """
    return service.get_routes(skip=skip, limit=limit)

@router.get(
    "/{route_id}", 
    response_model=ApisixRoute,
    summary="Get a specific APISIX Route",
    description="Retrieves a single APISIX Route by its unique ID."
)
def read_route(
    route_id: UUID,
    service: ApisixRouteService = Depends(get_route_service)
):
    """
    Retrieve a single APISIX Route by ID.
    Raises 404 Not Found if the route does not exist.
    """
    try:
        return service.get_route(route_id)
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )

@router.put(
    "/{route_id}", 
    response_model=ApisixRoute,
    summary="Update an APISIX Route",
    description="Updates an existing APISIX Route configuration."
)
def update_route(
    route_id: UUID,
    route_in: ApisixRouteUpdate,
    service: ApisixRouteService = Depends(get_route_service)
):
    """
    Update an existing APISIX Route by ID.
    Raises 404 Not Found if the route does not exist.
    Raises 409 Conflict if the new name conflicts with another existing route.
    """
    try:
        return service.update_route(route_id, route_in)
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except ConflictError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )

@router.delete(
    "/{route_id}", 
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an APISIX Route",
    description="Deletes an APISIX Route configuration by its unique ID."
)
def delete_route(
    route_id: UUID,
    service: ApisixRouteService = Depends(get_route_service)
):
    """
    Delete an APISIX Route by ID.
    Raises 404 Not Found if the route does not exist.
    """
    try:
        service.delete_route(route_id)
        return status.HTTP_204_NO_CONTENT
    except NotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )