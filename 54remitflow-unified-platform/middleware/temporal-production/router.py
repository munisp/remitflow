from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

import service
from database import get_db
from schemas import (
    WorkflowExecutionCreate, 
    WorkflowExecutionUpdate, 
    WorkflowExecutionInDB, 
    WorkflowExecutionList,
    WorkflowStatusSchema
)
from service import NotFoundError, DuplicateError

router = APIRouter(
    prefix="/executions",
    tags=["Workflow Executions"],
    responses={404: {"description": "Not found"}},
)

# --- Dependency for WorkflowStatus conversion ---
def get_workflow_status(status: Optional[WorkflowStatusSchema] = Query(None, description="Filter by workflow status.")) -> Optional[service.WorkflowStatus]:
    if status:
        # Convert Pydantic Enum to SQLAlchemy Enum
        return service.WorkflowStatus(status.value)
    return None

# --- CRUD Operations ---

@router.post(
    "/", 
    response_model=WorkflowExecutionInDB, 
    status_code=status.HTTP_201_CREATED,
    summary="Create a new Workflow Execution record"
)
def create_workflow_execution(
    execution: WorkflowExecutionCreate, 
    db: Session = Depends(get_db)
):
    """
    Creates a new record for a started Temporal Workflow Execution.
    The status is automatically set to RUNNING.
    """
    try:
        return service.create_execution(db=db, execution=execution)
    except DuplicateError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")

@router.get(
    "/", 
    response_model=WorkflowExecutionList,
    summary="List all Workflow Execution records"
)
def list_workflow_executions(
    skip: int = Query(0, ge=0, description="Number of records to skip for pagination."),
    limit: int = Query(100, le=1000, description="Maximum number of records to return."),
    status: Optional[service.WorkflowStatus] = Depends(get_workflow_status),
    workflow_type: Optional[str] = Query(None, description="Filter by workflow type."),
    db: Session = Depends(get_db)
):
    """
    Retrieves a list of all Workflow Execution records with optional filtering and pagination.
    """
    try:
        executions, total = service.list_executions(
            db=db, 
            skip=skip, 
            limit=limit, 
            status=status,
            workflow_type=workflow_type
        )
        return WorkflowExecutionList(total=total, executions=executions)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")

@router.get(
    "/{execution_id}", 
    response_model=WorkflowExecutionInDB,
    summary="Get a Workflow Execution record by ID"
)
def get_workflow_execution(
    execution_id: int, 
    db: Session = Depends(get_db)
):
    """
    Retrieves a single Workflow Execution record by its primary key ID.
    """
    try:
        return service.get_execution(db=db, execution_id=execution_id)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")

@router.put(
    "/{execution_id}", 
    response_model=WorkflowExecutionInDB,
    summary="Update a Workflow Execution record"
)
def update_workflow_execution(
    execution_id: int, 
    execution_update: WorkflowExecutionUpdate, 
    db: Session = Depends(get_db)
):
    """
    Updates an existing Workflow Execution record. This is typically used to update the status, 
    close_time, output_data, or error_details when the workflow completes or fails.
    """
    try:
        return service.update_execution(db=db, execution_id=execution_id, execution_update=execution_update)
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")

@router.delete(
    "/{execution_id}", 
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a Workflow Execution record"
)
def delete_workflow_execution(
    execution_id: int, 
    db: Session = Depends(get_db)
):
    """
    Deletes a Workflow Execution record by its primary key ID.
    """
    try:
        service.delete_execution(db=db, execution_id=execution_id)
        return
    except NotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"An unexpected error occurred: {e}")