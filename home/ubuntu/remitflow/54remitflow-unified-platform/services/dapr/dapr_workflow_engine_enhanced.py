#!/usr/bin/env python3
"""
Enhanced Dapr Workflow Engine for Remittance Platform
Implements distributed workflows using Dapr runtime with State Management and Pub/Sub
"""

import os
import json
import asyncio
import aiohttp
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from flask import Flask, request, jsonify
from flask_cors import CORS
import uuid
from enum import Enum

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class WorkflowStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"

class ActivityStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"

@dataclass
class WorkflowActivity:
    """Represents a single activity in a workflow"""
    activity_id: str
    name: str
    service_name: str
    endpoint: str
    input_data: Dict[str, Any]
    timeout_seconds: int = 300
    retry_attempts: int = 3
    retry_delay_seconds: int = 5
    status: ActivityStatus = ActivityStatus.PENDING
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    attempt_count: int = 0

@dataclass
class WorkflowDefinition:
    """Defines a complete workflow with activities and dependencies"""
    workflow_id: str
    name: str
    description: str
    activities: List[WorkflowActivity]
    dependencies: Dict[str, List[str]]
    timeout_seconds: int = 3600
    status: WorkflowStatus = WorkflowStatus.PENDING
    created_at: str = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class DaprStateManager:
    """Manages workflow state persistence using Dapr State Store"""
    
    def __init__(self, dapr_base_url: str, state_store_name: str = "statestore"):
        self.dapr_base_url = dapr_base_url
        self.state_store_name = state_store_name
    
    async def save_workflow_state(self, workflow: WorkflowDefinition) -> bool:
        """Save workflow state to Dapr State Store"""
        try:
            url = f"{self.dapr_base_url}/v1.0/state/{self.state_store_name}"
            
            # Convert workflow to dict for serialization
            workflow_dict = {
                "workflow_id": workflow.workflow_id,
                "name": workflow.name,
                "description": workflow.description,
                "status": workflow.status.value,
                "created_at": workflow.created_at,
                "started_at": workflow.started_at,
                "completed_at": workflow.completed_at,
                "result": workflow.result,
                "error": workflow.error,
                "timeout_seconds": workflow.timeout_seconds,
                "activities": [
                    {
                        "activity_id": act.activity_id,
                        "name": act.name,
                        "service_name": act.service_name,
                        "endpoint": act.endpoint,
                        "status": act.status.value,
                        "result": act.result,
                        "error": act.error,
                        "started_at": act.started_at,
                        "completed_at": act.completed_at,
                        "attempt_count": act.attempt_count
                    }
                    for act in workflow.activities
                ],
                "dependencies": workflow.dependencies
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=[{
                    "key": f"workflow_{workflow.workflow_id}",
                    "value": workflow_dict
                }]) as response:
                    if response.status == 204:
                        logger.info(f"Workflow state saved: {workflow.workflow_id}")
                        return True
                    else:
                        logger.error(f"Failed to save workflow state: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Error saving workflow state: {e}")
            return False
    
    async def load_workflow_state(self, workflow_id: str) -> Optional[Dict]:
        """Load workflow state from Dapr State Store"""
        try:
            url = f"{self.dapr_base_url}/v1.0/state/{self.state_store_name}/workflow_{workflow_id}"
            
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as response:
                    if response.status == 200:
                        data = await response.json()
                        logger.info(f"Workflow state loaded: {workflow_id}")
                        return data
                    elif response.status == 204:
                        logger.warning(f"Workflow state not found: {workflow_id}")
                        return None
                    else:
                        logger.error(f"Failed to load workflow state: {response.status}")
                        return None
        except Exception as e:
            logger.error(f"Error loading workflow state: {e}")
            return None
    
    async def delete_workflow_state(self, workflow_id: str) -> bool:
        """Delete workflow state from Dapr State Store"""
        try:
            url = f"{self.dapr_base_url}/v1.0/state/{self.state_store_name}"
            
            async with aiohttp.ClientSession() as session:
                async with session.delete(url, json=[{
                    "key": f"workflow_{workflow_id}"
                }]) as response:
                    if response.status == 204:
                        logger.info(f"Workflow state deleted: {workflow_id}")
                        return True
                    else:
                        logger.error(f"Failed to delete workflow state: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Error deleting workflow state: {e}")
            return False
    
    async def list_workflow_states(self) -> List[str]:
        """List all workflow IDs in state store"""
        try:
            # Note: This requires Dapr state store query API
            url = f"{self.dapr_base_url}/v1.0-alpha1/state/{self.state_store_name}/query"
            
            query = {
                "filter": {
                    "EQ": {"key": "workflow_*"}
                }
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=query) as response:
                    if response.status == 200:
                        data = await response.json()
                        return [item["key"].replace("workflow_", "") for item in data.get("results", [])]
                    else:
                        logger.warning("State store query not supported or failed")
                        return []
        except Exception as e:
            logger.error(f"Error listing workflow states: {e}")
            return []

class DaprPubSubManager:
    """Manages event-driven workflows using Dapr Pub/Sub"""
    
    def __init__(self, dapr_base_url: str, pubsub_name: str = "pubsub"):
        self.dapr_base_url = dapr_base_url
        self.pubsub_name = pubsub_name
    
    async def publish_workflow_event(self, topic: str, event_data: Dict[str, Any]) -> bool:
        """Publish workflow event via Dapr Pub/Sub"""
        try:
            url = f"{self.dapr_base_url}/v1.0/publish/{self.pubsub_name}/{topic}"
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=event_data) as response:
                    if response.status == 204:
                        logger.info(f"Event published to topic {topic}: {event_data.get('event_type')}")
                        return True
                    else:
                        logger.error(f"Failed to publish event: {response.status}")
                        return False
        except Exception as e:
            logger.error(f"Error publishing event: {e}")
            return False
    
    async def publish_workflow_started(self, workflow: WorkflowDefinition) -> bool:
        """Publish workflow started event"""
        event = {
            "event_type": "workflow.started",
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "workflow_id": workflow.workflow_id,
                "name": workflow.name,
                "description": workflow.description,
                "activity_count": len(workflow.activities)
            }
        }
        return await self.publish_workflow_event("workflow.events", event)
    
    async def publish_workflow_completed(self, workflow: WorkflowDefinition) -> bool:
        """Publish workflow completed event"""
        event = {
            "event_type": "workflow.completed",
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "workflow_id": workflow.workflow_id,
                "name": workflow.name,
                "status": workflow.status.value,
                "result": workflow.result,
                "duration_seconds": self._calculate_duration(workflow)
            }
        }
        return await self.publish_workflow_event("workflow.events", event)
    
    async def publish_workflow_failed(self, workflow: WorkflowDefinition) -> bool:
        """Publish workflow failed event"""
        event = {
            "event_type": "workflow.failed",
            "workflow_id": workflow.workflow_id,
            "workflow_name": workflow.name,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "workflow_id": workflow.workflow_id,
                "name": workflow.name,
                "error": workflow.error,
                "failed_activity": self._get_failed_activity(workflow)
            }
        }
        return await self.publish_workflow_event("workflow.events", event)
    
    async def publish_activity_completed(self, workflow_id: str, activity: WorkflowActivity) -> bool:
        """Publish activity completed event"""
        event = {
            "event_type": "activity.completed",
            "workflow_id": workflow_id,
            "activity_id": activity.activity_id,
            "timestamp": datetime.now().isoformat(),
            "data": {
                "activity_id": activity.activity_id,
                "name": activity.name,
                "service_name": activity.service_name,
                "status": activity.status.value,
                "result": activity.result
            }
        }
        return await self.publish_workflow_event("workflow.events", event)
    
    def _calculate_duration(self, workflow: WorkflowDefinition) -> Optional[float]:
        """Calculate workflow duration in seconds"""
        if workflow.started_at and workflow.completed_at:
            start = datetime.fromisoformat(workflow.started_at)
            end = datetime.fromisoformat(workflow.completed_at)
            return (end - start).total_seconds()
        return None
    
    def _get_failed_activity(self, workflow: WorkflowDefinition) -> Optional[str]:
        """Get the ID of the first failed activity"""
        for activity in workflow.activities:
            if activity.status == ActivityStatus.FAILED:
                return activity.activity_id
        return None

class EnhancedDaprWorkflowEngine:
    """
    Enhanced Dapr-based workflow engine with State Management and Pub/Sub
    """
    
    def __init__(self, dapr_http_port: int = 3500, dapr_grpc_port: int = 50001):
        self.dapr_http_port = dapr_http_port
        self.dapr_grpc_port = dapr_grpc_port
        self.dapr_base_url = f"http://localhost:{dapr_http_port}"
        
        # Initialize Dapr managers
        self.state_manager = DaprStateManager(self.dapr_base_url)
        self.pubsub_manager = DaprPubSubManager(self.dapr_base_url)
        
        # Workflow registry (in-memory cache)
        self.active_workflows: Dict[str, WorkflowDefinition] = {}
        self.completed_workflows: Dict[str, WorkflowDefinition] = {}
        
        # Banking service endpoints
        self.banking_services = {
            "kyb-verification": {"host": "localhost", "port": 8100, "app_id": "kyb-service"},
            "document-analysis": {"host": "localhost", "port": 8101, "app_id": "document-service"},
            "compliance-automation": {"host": "localhost", "port": 8102, "app_id": "compliance-service"},
            "payment-orchestrator": {"host": "localhost", "port": 8090, "app_id": "payment-service"},
            "fraud-detection": {"host": "localhost", "port": 8096, "app_id": "fraud-service"},
            "tigerbeetle-edge": {"host": "localhost", "port": 8095, "app_id": "accounting-service"},
            "insurance-suite": {"host": "localhost", "port": 8105, "app_id": "insurance-service"},
            "communication-core": {"host": "localhost", "port": 8103, "app_id": "communication-service"},
            "kya-analytics": {"host": "localhost", "port": 8104, "app_id": "analytics-service"}
        }
    
    async def start_workflow(self, workflow: WorkflowDefinition) -> bool:
        """Start a workflow with state persistence and event publishing"""
        try:
            workflow.status = WorkflowStatus.RUNNING
            workflow.started_at = datetime.now().isoformat()
            
            # Save to in-memory cache
            self.active_workflows[workflow.workflow_id] = workflow
            
            # Persist to state store
            await self.state_manager.save_workflow_state(workflow)
            
            # Publish workflow started event
            await self.pubsub_manager.publish_workflow_started(workflow)
            
            logger.info(f"Workflow started: {workflow.workflow_id}")
            return True
        except Exception as e:
            logger.error(f"Error starting workflow: {e}")
            return False
    
    async def complete_workflow(self, workflow_id: str, result: Dict[str, Any]) -> bool:
        """Complete a workflow with state persistence and event publishing"""
        try:
            workflow = self.active_workflows.get(workflow_id)
            if not workflow:
                logger.error(f"Workflow not found: {workflow_id}")
                return False
            
            workflow.status = WorkflowStatus.COMPLETED
            workflow.completed_at = datetime.now().isoformat()
            workflow.result = result
            
            # Move to completed workflows
            self.completed_workflows[workflow_id] = workflow
            del self.active_workflows[workflow_id]
            
            # Persist to state store
            await self.state_manager.save_workflow_state(workflow)
            
            # Publish workflow completed event
            await self.pubsub_manager.publish_workflow_completed(workflow)
            
            logger.info(f"Workflow completed: {workflow_id}")
            return True
        except Exception as e:
            logger.error(f"Error completing workflow: {e}")
            return False
    
    async def fail_workflow(self, workflow_id: str, error: str) -> bool:
        """Fail a workflow with state persistence and event publishing"""
        try:
            workflow = self.active_workflows.get(workflow_id)
            if not workflow:
                logger.error(f"Workflow not found: {workflow_id}")
                return False
            
            workflow.status = WorkflowStatus.FAILED
            workflow.completed_at = datetime.now().isoformat()
            workflow.error = error
            
            # Move to completed workflows
            self.completed_workflows[workflow_id] = workflow
            del self.active_workflows[workflow_id]
            
            # Persist to state store
            await self.state_manager.save_workflow_state(workflow)
            
            # Publish workflow failed event
            await self.pubsub_manager.publish_workflow_failed(workflow)
            
            logger.error(f"Workflow failed: {workflow_id} - {error}")
            return True
        except Exception as e:
            logger.error(f"Error failing workflow: {e}")
            return False
    
    async def recover_workflows(self) -> int:
        """Recover workflows from state store after crash"""
        try:
            workflow_ids = await self.state_manager.list_workflow_states()
            recovered_count = 0
            
            for workflow_id in workflow_ids:
                workflow_data = await self.state_manager.load_workflow_state(workflow_id)
                if workflow_data:
                    # Reconstruct workflow object
                    # (Simplified - full reconstruction would need more logic)
                    logger.info(f"Recovered workflow: {workflow_id}")
                    recovered_count += 1
            
            logger.info(f"Recovered {recovered_count} workflows from state store")
            return recovered_count
        except Exception as e:
            logger.error(f"Error recovering workflows: {e}")
            return 0
    
    async def invoke_service_via_dapr(self, service_name: str, endpoint: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Invoke a service using Dapr service invocation"""
        try:
            service_config = self.banking_services.get(service_name)
            if not service_config:
                raise ValueError(f"Service not found: {service_name}")
            
            app_id = service_config["app_id"]
            url = f"{self.dapr_base_url}/v1.0/invoke/{app_id}/method{endpoint}"
            
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=data) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        raise Exception(f"Service invocation failed: {response.status}")
        except Exception as e:
            logger.error(f"Error invoking service {service_name}: {e}")
            raise

# Flask app for HTTP endpoints
app = Flask(__name__)
CORS(app)

# Global workflow engine instance
workflow_engine = EnhancedDaprWorkflowEngine()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "Enhanced Dapr Workflow Engine",
        "timestamp": datetime.now().isoformat(),
        "active_workflows": len(workflow_engine.active_workflows),
        "completed_workflows": len(workflow_engine.completed_workflows)
    })

@app.route('/dapr/subscribe', methods=['GET'])
def subscribe():
    """Dapr subscription endpoint"""
    return jsonify([
        {
            "pubsubname": "pubsub",
            "topic": "workflow.triggers",
            "route": "/workflow/trigger"
        },
        {
            "pubsubname": "pubsub",
            "topic": "workflow.commands",
            "route": "/workflow/command"
        }
    ])

@app.route('/workflow/trigger', methods=['POST'])
async def handle_workflow_trigger():
    """Handle workflow trigger events from Pub/Sub"""
    try:
        event = request.json
        logger.info(f"Received workflow trigger: {event}")
        
        # Process trigger event
        # (Implementation would create and start workflow based on event)
        
        return jsonify({"status": "success"}), 200
    except Exception as e:
        logger.error(f"Error handling workflow trigger: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/workflow/command', methods=['POST'])
async def handle_workflow_command():
    """Handle workflow command events from Pub/Sub"""
    try:
        event = request.json
        logger.info(f"Received workflow command: {event}")
        
        # Process command event (pause, resume, cancel, etc.)
        
        return jsonify({"status": "success"}), 200
    except Exception as e:
        logger.error(f"Error handling workflow command: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/workflow/recover', methods=['POST'])
async def recover_workflows():
    """Recover workflows from state store"""
    try:
        count = await workflow_engine.recover_workflows()
        return jsonify({
            "status": "success",
            "recovered_count": count
        }), 200
    except Exception as e:
        logger.error(f"Error recovering workflows: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    logger.info("Starting Enhanced Dapr Workflow Engine with State Management and Pub/Sub")
    logger.info(f"Dapr HTTP Port: {workflow_engine.dapr_http_port}")
    logger.info(f"Dapr gRPC Port: {workflow_engine.dapr_grpc_port}")
    
    # Run Flask app
    app.run(host='0.0.0.0', port=8200, debug=False)

