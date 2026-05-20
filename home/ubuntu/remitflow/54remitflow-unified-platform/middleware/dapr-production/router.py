from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from schemas import DaprComponent, DaprComponentCreate, DaprComponentUpdate
from service import DaprComponentService, get_component_service, ComponentNotFoundError, ComponentAlreadyExistsError

router = APIRouter(
    prefix="/components",
    tags=["Dapr Components"],
    responses={404: {"description": "Not found"}},
)

@router.post(
    "/",
    response_model=DaprComponent,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Dapr Component",
    description="Creates a new Dapr component resource with associated metadata."
)
def create_component(
    component: DaprComponentCreate,
    service: DaprComponentService = Depends(get_component_service)
):
    try:
        return service.create_component(component)
    except ComponentAlreadyExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}"
        )

@router.get(
    "/",
    response_model=List[DaprComponent],
    summary="List all Dapr Components",
    description="Retrieves a paginated list of all Dapr component resources."
)
def list_components(
    skip: int = 0,
    limit: int = 100,
    service: DaprComponentService = Depends(get_component_service)
):
    return service.get_all_components(skip=skip, limit=limit)

@router.get(
    "/{component_id}",
    response_model=DaprComponent,
    summary="Get a Dapr Component by ID",
    description="Retrieves a single Dapr component resource by its unique ID."
)
def get_component(
    component_id: int,
    service: DaprComponentService = Depends(get_component_service)
):
    try:
        return service.get_component(component_id)
    except ComponentNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )

@router.put(
    "/{component_id}",
    response_model=DaprComponent,
    summary="Update a Dapr Component",
    description="Updates an existing Dapr component resource, including replacing its metadata."
)
def update_component(
    component_id: int,
    component: DaprComponentUpdate,
    service: DaprComponentService = Depends(get_component_service)
):
    try:
        return service.update_component(component_id, component)
    except ComponentNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except ComponentAlreadyExistsError as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )

@router.delete(
    "/{component_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Dapr Component",
    description="Deletes a Dapr component resource by its unique ID."
)
def delete_component(
    component_id: int,
    service: DaprComponentService = Depends(get_component_service)
):
    try:
        service.delete_component(component_id)
        return
    except ComponentNotFoundError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )