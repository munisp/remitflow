from datetime import datetime
from typing import Optional
from enum import Enum as PyEnum

from pydantic import BaseModel, Field

# --- Enums ---

class WorkflowStatusSchema(str, PyEnum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TERMINATED = "TERMINATED"
    CANCELED = "CANCELED"

# --- Base Schemas ---

class WorkflowExecutionBase(BaseModel):
    workflow_id: str = Field(..., description="Unique identifier for the workflow.")
    run_id: str = Field(..., description="Unique identifier for a specific run of the workflow.")
    workflow_type: str = Field(..., description="The type of the workflow (e.g., 'PaymentProcessingWorkflow').")
    task_queue: str = Field(..., description="The task queue the workflow was started on.")
    input_data: Optional[str] = Field(None, description="Input data for the workflow, typically JSON or a string.")

# --- Create and Update Schemas ---

class WorkflowExecutionCreate(WorkflowExecutionBase):
    """Schema for creating a new WorkflowExecution record."""
    pass

class WorkflowExecutionUpdate(BaseModel):
    """Schema for updating an existing WorkflowExecution record."""
    status: Optional[WorkflowStatusSchema] = Field(None, description="The current status of the workflow execution.")
    close_time: Optional[datetime] = Field(None, description="The time the workflow execution closed.")
    output_data: Optional[str] = Field(None, description="Output data from the completed workflow.")
    error_details: Optional[str] = Field(None, description="Details of the error if the workflow failed.")
    is_archived: Optional[bool] = Field(None, description="Whether the execution record has been archived.")

# --- Read Schemas ---

class WorkflowExecutionInDB(WorkflowExecutionBase):
    """Schema for reading a WorkflowExecution record from the database."""
    id: int = Field(..., description="Database primary key ID.")
    status: WorkflowStatusSchema = Field(WorkflowStatusSchema.RUNNING, description="The current status of the workflow execution.")
    start_time: datetime = Field(..., description="The time the workflow execution started.")
    close_time: Optional[datetime] = Field(None, description="The time the workflow execution closed.")
    output_data: Optional[str] = Field(None, description="Output data from the completed workflow.")
    error_details: Optional[str] = Field(None, description="Details of the error if the workflow failed.")
    is_archived: bool = Field(False, description="Whether the execution record has been archived.")

    class Config:
        orm_mode = True
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }

class WorkflowExecutionList(BaseModel):
    """Schema for listing multiple WorkflowExecution records."""
    total: int = Field(..., description="Total number of records matching the query.")
    executions: list[WorkflowExecutionInDB] = Field(..., description="List of workflow execution records.")