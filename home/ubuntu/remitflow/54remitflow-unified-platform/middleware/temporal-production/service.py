import logging
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session
from sqlalchemy import func

from models import WorkflowExecution, WorkflowStatus
from schemas import WorkflowExecutionCreate, WorkflowExecutionUpdate

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Custom Exceptions ---

class NotFoundError(Exception):
    """Raised when a requested resource is not found."""
    pass

class DuplicateError(Exception):
    """Raised when an attempt is made to create a duplicate resource."""
    pass

# --- Service Implementation ---

def create_execution(db: Session, execution: WorkflowExecutionCreate) -> WorkflowExecution:
    """
    Creates a new workflow execution record.
    """
    # Check for duplicate workflow_id
    if db.query(WorkflowExecution).filter(WorkflowExecution.workflow_id == execution.workflow_id).first():
        logger.warning(f"Attempted to create duplicate workflow_id: {execution.workflow_id}")
        raise DuplicateError(f"Workflow with ID '{execution.workflow_id}' already exists.")

    db_execution = WorkflowExecution(
        workflow_id=execution.workflow_id,
        run_id=execution.run_id,
        workflow_type=execution.workflow_type,
        task_queue=execution.task_queue,
        input_data=execution.input_data,
        status=WorkflowStatus.RUNNING # Always starts as RUNNING
    )
    
    try:
        db.add(db_execution)
        db.commit()
        db.refresh(db_execution)
        logger.info(f"Created new workflow execution: {db_execution.workflow_id}")
        return db_execution
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating workflow execution: {e}")
        raise

def get_execution(db: Session, execution_id: int) -> Optional[WorkflowExecution]:
    """
    Retrieves a single workflow execution by its primary key ID.
    """
    execution = db.query(WorkflowExecution).filter(WorkflowExecution.id == execution_id).first()
    if not execution:
        logger.info(f"Workflow execution with ID {execution_id} not found.")
        raise NotFoundError(f"Workflow execution with ID {execution_id} not found.")
    return execution

def get_execution_by_workflow_id(db: Session, workflow_id: str) -> Optional[WorkflowExecution]:
    """
    Retrieves a single workflow execution by its unique workflow_id.
    """
    execution = db.query(WorkflowExecution).filter(WorkflowExecution.workflow_id == workflow_id).first()
    if not execution:
        logger.info(f"Workflow execution with workflow_id {workflow_id} not found.")
        raise NotFoundError(f"Workflow execution with workflow_id {workflow_id} not found.")
    return execution

def list_executions(
    db: Session, 
    skip: int = 0, 
    limit: int = 100, 
    status: Optional[WorkflowStatus] = None,
    workflow_type: Optional[str] = None
) -> Tuple[List[WorkflowExecution], int]:
    """
    Lists workflow executions with optional filtering and pagination.
    Returns a tuple of (list of executions, total count).
    """
    query = db.query(WorkflowExecution)
    
    if status:
        query = query.filter(WorkflowExecution.status == status)
    
    if workflow_type:
        query = query.filter(WorkflowExecution.workflow_type == workflow_type)

    total_count = query.count()
    
    executions = query.offset(skip).limit(limit).all()
    
    logger.info(f"Listed {len(executions)} workflow executions (Total: {total_count}).")
    return executions, total_count

def update_execution(db: Session, execution_id: int, execution_update: WorkflowExecutionUpdate) -> WorkflowExecution:
    """
    Updates an existing workflow execution record.
    """
    db_execution = get_execution(db, execution_id) # Reuses get_execution for existence check and error handling
    
    update_data = execution_update.model_dump(exclude_unset=True)
    
    for key, value in update_data.items():
        setattr(db_execution, key, value)
    
    try:
        db.add(db_execution)
        db.commit()
        db.refresh(db_execution)
        logger.info(f"Updated workflow execution ID: {execution_id}")
        return db_execution
    except Exception as e:
        db.rollback()
        logger.error(f"Error updating workflow execution ID {execution_id}: {e}")
        raise

def delete_execution(db: Session, execution_id: int) -> WorkflowExecution:
    """
    Deletes a workflow execution record.
    """
    db_execution = get_execution(db, execution_id) # Reuses get_execution for existence check and error handling
    
    try:
        db.delete(db_execution)
        db.commit()
        logger.info(f"Deleted workflow execution ID: {execution_id}")
        return db_execution
    except Exception as e:
        db.rollback()
        logger.error(f"Error deleting workflow execution ID {execution_id}: {e}")
        raise