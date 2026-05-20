from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List

from database import get_db_session
from schemas import (
    RelationalTupleCreate, RelationalTupleInDB, TupleFilter,
    AttributeCreate, AttributeUpdate, AttributeInDB, AttributeFilter
)
from service import (
    RelationalTupleService, AttributeService,
    NotFoundException, AlreadyExistsException, ServiceException, InvalidDataException
)

router = APIRouter(prefix="/v1/data", tags=["Data Service"])

# --- Dependency Functions ---

def get_tuple_service(db: AsyncSession = Depends(get_db_session)) -> RelationalTupleService:
    """Dependency to get the RelationalTupleService instance."""
    return RelationalTupleService(db)

def get_attribute_service(db: AsyncSession = Depends(get_db_session)) -> AttributeService:
    """Dependency to get the AttributeService instance."""
    return AttributeService(db)

# --- Relational Tuple Endpoints ---

@router.post(
    "/tuples",
    response_model=RelationalTupleInDB,
    status_code=status.HTTP_201_CREATED,
    summary="Write Relational Tuple",
    description="Creates a new relational tuple (relationship) in the authorization data store."
)
async def create_tuple(
    tuple_data: RelationalTupleCreate,
    service: RelationalTupleService = Depends(get_tuple_service)
):
    try:
        new_tuple = await service.create_tuple(tuple_data)
        return new_tuple
    except AlreadyExistsException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.get(
    "/tuples",
    response_model=List[RelationalTupleInDB],
    summary="List Relational Tuples",
    description="Retrieves a list of relational tuples, optionally filtered by entity, relation, or subject."
)
async def list_tuples(
    filters: TupleFilter = Depends(),
    service: RelationalTupleService = Depends(get_tuple_service)
):
    try:
        tuples = await service.list_tuples(filters)
        return tuples
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.get(
    "/tuples/{tuple_id}",
    response_model=RelationalTupleInDB,
    summary="Read Relational Tuple",
    description="Retrieves a single relational tuple by its ID."
)
async def read_tuple(
    tuple_id: int,
    service: RelationalTupleService = Depends(get_tuple_service)
):
    try:
        tuple_obj = await service.get_tuple(tuple_id)
        return tuple_obj
    except NotFoundException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.delete(
    "/tuples/{tuple_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Relational Tuple",
    description="Deletes a relational tuple by its ID."
)
async def delete_tuple(
    tuple_id: int,
    service: RelationalTupleService = Depends(get_tuple_service)
):
    try:
        await service.delete_tuple(tuple_id)
        return
    except NotFoundException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

# --- Attribute Endpoints ---

@router.post(
    "/attributes",
    response_model=AttributeInDB,
    status_code=status.HTTP_201_CREATED,
    summary="Write Attribute",
    description="Creates a new attribute associated with an entity."
)
async def create_attribute(
    attribute_data: AttributeCreate,
    service: AttributeService = Depends(get_attribute_service)
):
    try:
        new_attribute = await service.create_attribute(attribute_data)
        return new_attribute
    except AlreadyExistsException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.get(
    "/attributes",
    response_model=List[AttributeInDB],
    summary="List Attributes",
    description="Retrieves a list of attributes, optionally filtered by entity or attribute name/type."
)
async def list_attributes(
    filters: AttributeFilter = Depends(),
    service: AttributeService = Depends(get_attribute_service)
):
    try:
        attributes = await service.list_attributes(filters)
        return attributes
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.get(
    "/attributes/{attribute_id}",
    response_model=AttributeInDB,
    summary="Read Attribute",
    description="Retrieves a single attribute by its ID."
)
async def read_attribute(
    attribute_id: int,
    service: AttributeService = Depends(get_attribute_service)
):
    try:
        attribute_obj = await service.get_attribute(attribute_id)
        return attribute_obj
    except NotFoundException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.put(
    "/attributes/{attribute_id}",
    response_model=AttributeInDB,
    summary="Update Attribute",
    description="Updates an existing attribute by its ID."
)
async def update_attribute(
    attribute_id: int,
    attribute_data: AttributeUpdate,
    service: AttributeService = Depends(get_attribute_service)
):
    try:
        updated_attribute = await service.update_attribute(attribute_id, attribute_data)
        return updated_attribute
    except NotFoundException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)

@router.delete(
    "/attributes/{attribute_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Attribute",
    description="Deletes an attribute by its ID."
)
async def delete_attribute(
    attribute_id: int,
    service: AttributeService = Depends(get_attribute_service)
):
    try:
        await service.delete_attribute(attribute_id)
        return
    except NotFoundException as e:
        raise HTTPException(status_code=e.status_code, detail=e.message)
    except ServiceException as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=e.message)