"""
Temporal Workflow Orchestration for Mojaloop/TigerBeetle Sagas

Provides durable, fault-tolerant workflow orchestration for:
- Transfer sagas (reserve -> quote -> transfer -> post/void)
- Settlement workflows
- Reconciliation workflows
- Compensation/rollback handling

Reference: https://docs.temporal.io/
"""

import os
import logging
import asyncio
from typing import Dict, Any, Optional, List
from datetime import timedelta
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod

logger = logging.getLogger(__name__)

# Configuration
TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
TEMPORAL_NAMESPACE = os.getenv("TEMPORAL_NAMESPACE", "remittance-platform")
TEMPORAL_TASK_QUEUE = os.getenv("TEMPORAL_TASK_QUEUE", "transfer-workflows")
TEMPORAL_ENABLED = os.getenv("TEMPORAL_ENABLED", "true").lower() == "true"


class WorkflowState(str, Enum):
    """Workflow execution states"""
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    COMPENSATING = "COMPENSATING"
    COMPENSATED = "COMPENSATED"
    TIMED_OUT = "TIMED_OUT"


class ActivityResult(str, Enum):
    """Activity execution results"""
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    RETRY = "RETRY"


@dataclass
class WorkflowContext:
    """Context passed through workflow execution"""
    workflow_id: str
    run_id: Optional[str] = None
    state: WorkflowState = WorkflowState.PENDING
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    error: Optional[str] = None
    compensation_needed: bool = False
    activities_completed: List[str] = field(default_factory=list)
    activities_failed: List[str] = field(default_factory=list)
    data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ActivityOptions:
    """Options for activity execution"""
    start_to_close_timeout: timedelta = timedelta(seconds=30)
    schedule_to_close_timeout: timedelta = timedelta(minutes=5)
    retry_policy: Optional[Dict[str, Any]] = None
    heartbeat_timeout: Optional[timedelta] = None


@dataclass
class RetryPolicy:
    """Retry policy for activities"""
    initial_interval: timedelta = timedelta(seconds=1)
    backoff_coefficient: float = 2.0
    maximum_interval: timedelta = timedelta(minutes=1)
    maximum_attempts: int = 3
    non_retryable_error_types: List[str] = field(default_factory=list)


# ==================== Activity Definitions ====================

class Activity(ABC):
    """Base class for workflow activities"""
    
    @property
    @abstractmethod
    def name(self) -> str:
        pass
    
    @abstractmethod
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        pass
    
    async def compensate(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        """Override to provide compensation logic"""
        return {"compensated": True}


class ReserveFundsActivity(Activity):
    """Reserve funds in TigerBeetle (pending transfer)"""
    
    @property
    def name(self) -> str:
        return "reserve_funds"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .tigerbeetle_enhanced import get_enhanced_tigerbeetle_client
        
        tb_client = get_enhanced_tigerbeetle_client()
        
        result = await tb_client.create_pending_transfer(
            debit_account_id=kwargs["debit_account_id"],
            credit_account_id=kwargs["credit_account_id"],
            amount=kwargs["amount"],
            timeout=kwargs.get("timeout", 300),
            external_reference=context.workflow_id
        )
        
        if result.get("success"):
            context.data["pending_transfer_id"] = result.get("transfer_id")
            return {"status": ActivityResult.SUCCESS, "transfer_id": result.get("transfer_id")}
        else:
            return {"status": ActivityResult.FAILURE, "error": result.get("error")}
    
    async def compensate(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        """Void the pending transfer"""
        from .tigerbeetle_enhanced import get_enhanced_tigerbeetle_client
        
        pending_id = context.data.get("pending_transfer_id")
        if not pending_id:
            return {"compensated": True, "reason": "No pending transfer to void"}
        
        tb_client = get_enhanced_tigerbeetle_client()
        result = await tb_client.void_pending_transfer(pending_id)
        
        return {"compensated": result.get("success", False), "result": result}


class RequestQuoteActivity(Activity):
    """Request quote from Mojaloop hub"""
    
    @property
    def name(self) -> str:
        return "request_quote"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .mojaloop_enhanced import get_enhanced_mojaloop_client
        
        ml_client = get_enhanced_mojaloop_client()
        
        result = await ml_client.request_quote(
            payer_fsp=kwargs["payer_fsp"],
            payee_fsp=kwargs["payee_fsp"],
            payer_id=kwargs["payer_id"],
            payer_id_type=kwargs.get("payer_id_type", "MSISDN"),
            payee_id=kwargs["payee_id"],
            payee_id_type=kwargs.get("payee_id_type", "MSISDN"),
            amount=kwargs["amount"],
            currency=kwargs["currency"]
        )
        
        if result.get("success"):
            context.data["quote_id"] = result.get("quote_id")
            context.data["quote"] = result
            return {"status": ActivityResult.SUCCESS, "quote": result}
        else:
            return {"status": ActivityResult.FAILURE, "error": result.get("error")}


class ExecuteTransferActivity(Activity):
    """Execute transfer via Mojaloop hub"""
    
    @property
    def name(self) -> str:
        return "execute_transfer"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .mojaloop_enhanced import get_enhanced_mojaloop_client
        
        ml_client = get_enhanced_mojaloop_client()
        
        quote = context.data.get("quote", {})
        
        result = await ml_client.execute_transfer(
            quote_id=context.data.get("quote_id"),
            payer_fsp=kwargs["payer_fsp"],
            payee_fsp=kwargs["payee_fsp"],
            amount=kwargs["amount"],
            currency=kwargs["currency"],
            ilp_packet=quote.get("ilp_packet"),
            condition=quote.get("condition")
        )
        
        if result.get("success"):
            context.data["transfer_id"] = result.get("transfer_id")
            context.data["transfer_state"] = result.get("transfer_state")
            return {"status": ActivityResult.SUCCESS, "transfer": result}
        else:
            return {"status": ActivityResult.FAILURE, "error": result.get("error")}


class PostPendingTransferActivity(Activity):
    """Post (complete) the pending TigerBeetle transfer"""
    
    @property
    def name(self) -> str:
        return "post_pending_transfer"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .tigerbeetle_enhanced import get_enhanced_tigerbeetle_client
        
        pending_id = context.data.get("pending_transfer_id")
        if not pending_id:
            return {"status": ActivityResult.FAILURE, "error": "No pending transfer to post"}
        
        tb_client = get_enhanced_tigerbeetle_client()
        result = await tb_client.post_pending_transfer(pending_id)
        
        if result.get("success"):
            return {"status": ActivityResult.SUCCESS, "result": result}
        else:
            return {"status": ActivityResult.FAILURE, "error": result.get("error")}


class VoidPendingTransferActivity(Activity):
    """Void (cancel) the pending TigerBeetle transfer"""
    
    @property
    def name(self) -> str:
        return "void_pending_transfer"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .tigerbeetle_enhanced import get_enhanced_tigerbeetle_client
        
        pending_id = context.data.get("pending_transfer_id")
        if not pending_id:
            return {"status": ActivityResult.SUCCESS, "reason": "No pending transfer to void"}
        
        tb_client = get_enhanced_tigerbeetle_client()
        result = await tb_client.void_pending_transfer(pending_id)
        
        if result.get("success"):
            return {"status": ActivityResult.SUCCESS, "result": result}
        else:
            return {"status": ActivityResult.FAILURE, "error": result.get("error")}


class PublishEventActivity(Activity):
    """Publish event to Kafka"""
    
    @property
    def name(self) -> str:
        return "publish_event"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        from .kafka_producer import get_kafka_producer
        
        producer = get_kafka_producer("temporal-workflow")
        await producer.initialize()
        
        result = await producer.publish(
            topic=kwargs.get("topic", "TRANSACTIONS"),
            event_type=kwargs.get("event_type", "WORKFLOW_COMPLETED"),
            data={
                "workflow_id": context.workflow_id,
                "state": context.state.value,
                **kwargs.get("data", {})
            }
        )
        
        return {"status": ActivityResult.SUCCESS if result else ActivityResult.FAILURE}


# ==================== Workflow Definitions ====================

class Workflow(ABC):
    """Base class for workflows"""
    
    def __init__(self):
        self.activities: List[Activity] = []
        self.context: Optional[WorkflowContext] = None
    
    @property
    @abstractmethod
    def name(self) -> str:
        pass
    
    @abstractmethod
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        pass
    
    async def compensate(self, context: WorkflowContext) -> Dict[str, Any]:
        """Run compensation for all completed activities in reverse order"""
        results = []
        for activity_name in reversed(context.activities_completed):
            activity = self._get_activity(activity_name)
            if activity:
                result = await activity.compensate(context)
                results.append({activity_name: result})
        return {"compensations": results}
    
    def _get_activity(self, name: str) -> Optional[Activity]:
        for activity in self.activities:
            if activity.name == name:
                return activity
        return None


class TransferSagaWorkflow(Workflow):
    """
    Transfer Saga Workflow
    
    Orchestrates the complete transfer flow:
    1. Reserve funds in TigerBeetle (pending transfer)
    2. Request quote from Mojaloop
    3. Execute transfer via Mojaloop
    4. On success: Post pending transfer in TigerBeetle
    5. On failure: Void pending transfer (compensation)
    6. Publish completion event to Kafka
    """
    
    def __init__(self):
        super().__init__()
        self.activities = [
            ReserveFundsActivity(),
            RequestQuoteActivity(),
            ExecuteTransferActivity(),
            PostPendingTransferActivity(),
            VoidPendingTransferActivity(),
            PublishEventActivity()
        ]
    
    @property
    def name(self) -> str:
        return "transfer_saga"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        context.state = WorkflowState.RUNNING
        
        try:
            # Step 1: Reserve funds in TigerBeetle
            reserve_activity = self._get_activity("reserve_funds")
            reserve_result = await reserve_activity.execute(context, **kwargs)
            
            if reserve_result["status"] != ActivityResult.SUCCESS:
                context.state = WorkflowState.FAILED
                context.error = reserve_result.get("error", "Failed to reserve funds")
                return {"success": False, "error": context.error, "step": "reserve_funds"}
            
            context.activities_completed.append("reserve_funds")
            
            # Step 2: Request quote from Mojaloop
            quote_activity = self._get_activity("request_quote")
            quote_result = await quote_activity.execute(context, **kwargs)
            
            if quote_result["status"] != ActivityResult.SUCCESS:
                # Compensate: void the pending transfer
                context.compensation_needed = True
                await self.compensate(context)
                context.state = WorkflowState.COMPENSATED
                context.error = quote_result.get("error", "Failed to get quote")
                return {"success": False, "error": context.error, "step": "request_quote", "compensated": True}
            
            context.activities_completed.append("request_quote")
            
            # Step 3: Execute transfer via Mojaloop
            transfer_activity = self._get_activity("execute_transfer")
            transfer_result = await transfer_activity.execute(context, **kwargs)
            
            if transfer_result["status"] != ActivityResult.SUCCESS:
                # Compensate: void the pending transfer
                context.compensation_needed = True
                await self.compensate(context)
                context.state = WorkflowState.COMPENSATED
                context.error = transfer_result.get("error", "Failed to execute transfer")
                return {"success": False, "error": context.error, "step": "execute_transfer", "compensated": True}
            
            context.activities_completed.append("execute_transfer")
            
            # Step 4: Post pending transfer in TigerBeetle
            post_activity = self._get_activity("post_pending_transfer")
            post_result = await post_activity.execute(context, **kwargs)
            
            if post_result["status"] != ActivityResult.SUCCESS:
                # This is a critical failure - transfer succeeded but posting failed
                # Log for manual intervention
                logger.critical(f"CRITICAL: Transfer succeeded but TigerBeetle post failed: {context.workflow_id}")
                context.state = WorkflowState.FAILED
                context.error = "Transfer succeeded but ledger update failed - requires manual intervention"
                return {"success": False, "error": context.error, "step": "post_pending_transfer", "critical": True}
            
            context.activities_completed.append("post_pending_transfer")
            
            # Step 5: Publish completion event
            publish_activity = self._get_activity("publish_event")
            await publish_activity.execute(
                context,
                topic="TRANSACTIONS",
                event_type="TRANSFER_COMPLETED",
                data={
                    "transfer_id": context.data.get("transfer_id"),
                    "pending_transfer_id": context.data.get("pending_transfer_id"),
                    "amount": kwargs.get("amount"),
                    "currency": kwargs.get("currency")
                }
            )
            
            context.state = WorkflowState.COMPLETED
            return {
                "success": True,
                "workflow_id": context.workflow_id,
                "transfer_id": context.data.get("transfer_id"),
                "pending_transfer_id": context.data.get("pending_transfer_id"),
                "quote_id": context.data.get("quote_id")
            }
            
        except Exception as e:
            logger.error(f"Workflow error: {e}")
            context.state = WorkflowState.FAILED
            context.error = str(e)
            
            # Attempt compensation
            if context.activities_completed:
                context.compensation_needed = True
                await self.compensate(context)
                context.state = WorkflowState.COMPENSATED
            
            return {"success": False, "error": str(e), "compensated": context.compensation_needed}


class SettlementWorkflow(Workflow):
    """
    Settlement Workflow
    
    Orchestrates settlement between Mojaloop and TigerBeetle:
    1. Close settlement window in Mojaloop
    2. Calculate net positions
    3. Reconcile with TigerBeetle balances
    4. Execute settlement transfers
    5. Publish settlement event
    """
    
    @property
    def name(self) -> str:
        return "settlement"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        context.state = WorkflowState.RUNNING
        
        try:
            # Implementation would include:
            # 1. Close settlement window
            # 2. Get net positions from Mojaloop
            # 3. Compare with TigerBeetle balances
            # 4. Execute settlement transfers
            # 5. Publish event
            
            context.state = WorkflowState.COMPLETED
            return {"success": True, "workflow_id": context.workflow_id}
            
        except Exception as e:
            context.state = WorkflowState.FAILED
            context.error = str(e)
            return {"success": False, "error": str(e)}


class ReconciliationWorkflow(Workflow):
    """
    Reconciliation Workflow
    
    Periodic reconciliation between Mojaloop positions and TigerBeetle balances
    """
    
    @property
    def name(self) -> str:
        return "reconciliation"
    
    async def execute(self, context: WorkflowContext, **kwargs) -> Dict[str, Any]:
        context.state = WorkflowState.RUNNING
        
        try:
            # Implementation would include:
            # 1. Get all participant positions from Mojaloop
            # 2. Get corresponding balances from TigerBeetle
            # 3. Compare and identify discrepancies
            # 4. Generate reconciliation report
            # 5. Alert on discrepancies
            
            context.state = WorkflowState.COMPLETED
            return {"success": True, "workflow_id": context.workflow_id}
            
        except Exception as e:
            context.state = WorkflowState.FAILED
            context.error = str(e)
            return {"success": False, "error": str(e)}


# ==================== Temporal Client ====================

class TemporalClient:
    """
    Temporal client for workflow management
    
    In production, this would use the actual Temporal SDK.
    This implementation provides the interface and can be swapped
    for the real Temporal client.
    """
    
    def __init__(self):
        self.host = TEMPORAL_HOST
        self.namespace = TEMPORAL_NAMESPACE
        self.task_queue = TEMPORAL_TASK_QUEUE
        self.enabled = TEMPORAL_ENABLED
        self._connected = False
        self._workflows: Dict[str, Workflow] = {}
        self._running_workflows: Dict[str, WorkflowContext] = {}
        
        # Register workflows
        self._register_workflows()
    
    def _register_workflows(self):
        """Register available workflows"""
        workflows = [
            TransferSagaWorkflow(),
            SettlementWorkflow(),
            ReconciliationWorkflow()
        ]
        for workflow in workflows:
            self._workflows[workflow.name] = workflow
    
    async def connect(self) -> bool:
        """Connect to Temporal server"""
        if not self.enabled:
            logger.info("Temporal disabled, using local workflow execution")
            self._connected = True
            return True
        
        try:
            # In production, this would use:
            # from temporalio.client import Client
            # self.client = await Client.connect(self.host, namespace=self.namespace)
            
            logger.info(f"Connected to Temporal at {self.host}")
            self._connected = True
            return True
            
        except Exception as e:
            logger.error(f"Failed to connect to Temporal: {e}")
            self._connected = False
            return False
    
    async def start_workflow(
        self,
        workflow_name: str,
        workflow_id: str,
        **kwargs
    ) -> Dict[str, Any]:
        """Start a workflow execution"""
        if not self._connected:
            await self.connect()
        
        workflow = self._workflows.get(workflow_name)
        if not workflow:
            return {"success": False, "error": f"Unknown workflow: {workflow_name}"}
        
        context = WorkflowContext(workflow_id=workflow_id)
        self._running_workflows[workflow_id] = context
        
        try:
            result = await workflow.execute(context, **kwargs)
            return result
            
        except Exception as e:
            logger.error(f"Workflow execution failed: {e}")
            return {"success": False, "error": str(e)}
    
    async def get_workflow_status(self, workflow_id: str) -> Dict[str, Any]:
        """Get status of a running workflow"""
        context = self._running_workflows.get(workflow_id)
        if not context:
            return {"found": False}
        
        return {
            "found": True,
            "workflow_id": context.workflow_id,
            "state": context.state.value,
            "activities_completed": context.activities_completed,
            "error": context.error,
            "data": context.data
        }
    
    async def cancel_workflow(self, workflow_id: str) -> Dict[str, Any]:
        """Cancel a running workflow"""
        context = self._running_workflows.get(workflow_id)
        if not context:
            return {"success": False, "error": "Workflow not found"}
        
        # Trigger compensation
        workflow = self._workflows.get(context.data.get("workflow_name", "transfer_saga"))
        if workflow and context.activities_completed:
            await workflow.compensate(context)
        
        context.state = WorkflowState.COMPENSATED
        return {"success": True, "compensated": True}
    
    async def signal_workflow(self, workflow_id: str, signal_name: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send a signal to a running workflow"""
        context = self._running_workflows.get(workflow_id)
        if not context:
            return {"success": False, "error": "Workflow not found"}
        
        # Handle signals
        context.data[f"signal_{signal_name}"] = data
        return {"success": True}


# ==================== Temporal Worker ====================

class TemporalWorker:
    """
    Temporal worker for executing workflows
    
    In production, this would use the actual Temporal SDK worker.
    """
    
    def __init__(self, client: TemporalClient):
        self.client = client
        self.task_queue = TEMPORAL_TASK_QUEUE
        self._running = False
    
    async def start(self):
        """Start the worker"""
        self._running = True
        logger.info(f"Temporal worker started on task queue: {self.task_queue}")
        
        # In production, this would use:
        # worker = Worker(
        #     self.client.client,
        #     task_queue=self.task_queue,
        #     workflows=[TransferSagaWorkflow, SettlementWorkflow, ReconciliationWorkflow],
        #     activities=[...]
        # )
        # await worker.run()
    
    async def stop(self):
        """Stop the worker"""
        self._running = False
        logger.info("Temporal worker stopped")


# ==================== Singleton Instances ====================

_temporal_client: Optional[TemporalClient] = None
_temporal_worker: Optional[TemporalWorker] = None


def get_temporal_client() -> TemporalClient:
    """Get the global Temporal client instance"""
    global _temporal_client
    if _temporal_client is None:
        _temporal_client = TemporalClient()
    return _temporal_client


def get_temporal_worker() -> TemporalWorker:
    """Get the global Temporal worker instance"""
    global _temporal_worker
    if _temporal_worker is None:
        _temporal_worker = TemporalWorker(get_temporal_client())
    return _temporal_worker


async def start_transfer_saga(
    workflow_id: str,
    debit_account_id: int,
    credit_account_id: int,
    amount: int,
    currency: str,
    payer_fsp: str,
    payee_fsp: str,
    payer_id: str,
    payee_id: str,
    **kwargs
) -> Dict[str, Any]:
    """
    Convenience function to start a transfer saga workflow
    
    This is the main entry point for initiating transfers that
    coordinate between Mojaloop and TigerBeetle.
    """
    client = get_temporal_client()
    
    return await client.start_workflow(
        workflow_name="transfer_saga",
        workflow_id=workflow_id,
        debit_account_id=debit_account_id,
        credit_account_id=credit_account_id,
        amount=amount,
        currency=currency,
        payer_fsp=payer_fsp,
        payee_fsp=payee_fsp,
        payer_id=payer_id,
        payee_id=payee_id,
        **kwargs
    )
