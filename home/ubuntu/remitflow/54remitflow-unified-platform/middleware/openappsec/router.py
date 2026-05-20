from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from . import schemas, service
from .database import get_db
from .service import PolicyNotFound, PolicyAlreadyExists

router = APIRouter(
    prefix="/policies",
    tags=["WAF Policies"],
    responses={404: {"description": "Not found"}},
)

@router.post(
    "/", 
    response_model=schemas.WAFPolicy, 
    status_code=status.HTTP_201_CREATED,
    summary="Create a new WAF Policy",
    description="Creates a new open-appsec WAF policy configuration."
)
def create_waf_policy(policy: schemas.WAFPolicyCreate, db: Session = Depends(get_db)):
    """
    Create a WAF Policy with the given configuration.
    """
    try:
        return service.create_policy(db=db, policy_data=policy)
    except PolicyAlreadyExists as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )

@router.get(
    "/", 
    response_model=List[schemas.WAFPolicy],
    summary="List all WAF Policies",
    description="Retrieves a list of all configured WAF policies with optional pagination."
)
def read_waf_policies(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    """
    Retrieve a list of WAF Policies.
    """
    policies = service.get_all_policies(db, skip=skip, limit=limit)
    return policies

@router.get(
    "/{policy_id}", 
    response_model=schemas.WAFPolicy,
    summary="Get a WAF Policy by ID",
    description="Retrieves a single WAF policy configuration by its unique ID."
)
def read_waf_policy(policy_id: int, db: Session = Depends(get_db)):
    """
    Retrieve a single WAF Policy by ID.
    """
    try:
        db_policy = service.get_policy_by_id(db, policy_id=policy_id)
        return db_policy
    except PolicyNotFound as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )

@router.patch(
    "/{policy_id}", 
    response_model=schemas.WAFPolicy,
    summary="Update an existing WAF Policy",
    description="Partially updates an existing WAF policy configuration by ID."
)
def update_waf_policy(policy_id: int, policy: schemas.WAFPolicyUpdate, db: Session = Depends(get_db)):
    """
    Update an existing WAF Policy.
    """
    try:
        return service.update_policy(db=db, policy_id=policy_id, policy_data=policy)
    except PolicyNotFound as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except PolicyAlreadyExists as e:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )

@router.delete(
    "/{policy_id}", 
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a WAF Policy",
    description="Deletes a WAF policy configuration by ID."
)
def delete_waf_policy(policy_id: int, db: Session = Depends(get_db)):
    """
    Delete a WAF Policy by ID.
    """
    try:
        service.delete_policy(db=db, policy_id=policy_id)
        return
    except PolicyNotFound as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )