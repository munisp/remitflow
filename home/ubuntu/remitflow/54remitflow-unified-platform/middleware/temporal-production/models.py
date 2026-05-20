from sqlalchemy import Column, Integer, String, DateTime, Boolean, func, Enum
from sqlalchemy.ext.declarative import declarative_base
import enum

Base = declarative_base()

class WorkflowStatus(enum.Enum):
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    TERMINATED = "TERMINATED"
    CANCELED = "CANCELED"

class WorkflowExecution(Base):
    __tablename__ = "workflow_executions"

    id = Column(Integer, primary_key=True, index=True)
    workflow_id = Column(String, unique=True, index=True, nullable=False)
    run_id = Column(String, index=True, nullable=False)
    workflow_type = Column(String, nullable=False)
    task_queue = Column(String, nullable=False)
    status = Column(Enum(WorkflowStatus), default=WorkflowStatus.RUNNING, nullable=False)
    start_time = Column(DateTime, default=func.now(), nullable=False)
    close_time = Column(DateTime, nullable=True)
    input_data = Column(String, nullable=True)
    output_data = Column(String, nullable=True)
    error_details = Column(String, nullable=True)
    is_archived = Column(Boolean, default=False, nullable=False)

    # Add a unique constraint on workflow_id and run_id for better indexing/integrity
    # Note: SQLAlchemy ORM doesn't directly support composite unique constraints in __tablename__
    # but we can add it via __table_args__ if needed, for simplicity we'll rely on workflow_id unique for now
    # as a proxy for a unique execution record in this simplified model.
    # In a real Temporal system, workflow_id is unique per namespace, and run_id is unique per workflow_id.

    def __repr__(self):
        return f"<WorkflowExecution(workflow_id='{self.workflow_id}', run_id='{self.run_id}', status='{self.status.value}')>"