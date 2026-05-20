#!/usr/bin/env python3
"""
Business Rules Orchestrator Service
Integrates business rules reasoning engine with AI/ML services
"""

import asyncio
import json
import logging
import os
import sys
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from enum import Enum

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Add business rules reasoning to path
sys.path.append('/home/ubuntu/business-rules-repo/src')

try:
    from business_rules_reasoning import (
        RuleSet, 
        LLMOrchestrator, 
        ReasoningMethod,
        VariableFetchingMode
    )
except ImportError:
    # Fallback implementation for development
    class RuleSet:
        def __init__(self):
            self.rules = []
        
        def add_rule(self, rule):
            self.rules.append(rule)
    
    class LLMOrchestrator:
        def __init__(self, knowledge_base, llm_client=None):
            self.knowledge_base = knowledge_base
            self.llm_client = llm_client
        
        async def reason(self, facts, method="deduction"):
            return {"conclusion": "mock_result", "confidence": 0.95}
    
    class ReasoningMethod:
        DEDUCTION = "deduction"
        HYPOTHESIS_TESTING = "hypothesis_testing"
    
    class VariableFetchingMode:
        AUTOMATIC = "automatic"
        MANUAL = "manual"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Business Rules Orchestrator",
    description="AI/ML Business Rules Reasoning Service",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
AI_ML_SERVICES = {
    "coco_index": "http://localhost:8085/coco",
    "epr_kgqa": "http://localhost:8085/epr",
    "falkor_db": "http://localhost:8085/falkor",
    "ollama": "http://localhost:8085/ollama",
    "art": "http://localhost:8085/art",
    "lakehouse_gnn": "http://localhost:8085/lakehouse"
}

# Data Models
class ReasoningRequest(BaseModel):
    service: str = Field(..., description="Target AI/ML service")
    facts: Dict[str, Any] = Field(..., description="Input facts for reasoning")
    rules: Optional[List[str]] = Field(None, description="Custom rules to apply")
    method: str = Field("deduction", description="Reasoning method")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")

class ReasoningResponse(BaseModel):
    service: str
    conclusion: Dict[str, Any]
    confidence: float
    reasoning_trace: List[str]
    execution_time: float
    timestamp: datetime

class ServiceStatus(BaseModel):
    service: str
    status: str
    last_check: datetime
    response_time: Optional[float] = None

# Global state
redis_client: Optional[redis.Redis] = None
reasoning_cache: Dict[str, Any] = {}

@dataclass
class BusinessRule:
    """Business rule definition"""
    id: str
    name: str
    condition: str
    action: str
    priority: int = 1
    enabled: bool = True
    service_scope: List[str] = None

class RuleEngine:
    """Enhanced rule engine for AI/ML service integration"""
    
    def __init__(self):
        self.rules: Dict[str, BusinessRule] = {}
        self.knowledge_base = RuleSet()
        self.orchestrator = None
        self._initialize_default_rules()
    
    def _initialize_default_rules(self):
        """Initialize default business rules for AI/ML services"""
        
        # CocoIndex rules
        self.add_rule(BusinessRule(
            id="coco_confidence_threshold",
            name="CocoIndex Confidence Threshold",
            condition="confidence < 0.8",
            action="request_human_review",
            service_scope=["coco_index"]
        ))
        
        # EPR-KGQA rules
        self.add_rule(BusinessRule(
            id="epr_query_complexity",
            name="EPR Query Complexity Check",
            condition="query_tokens > 100",
            action="split_query",
            service_scope=["epr_kgqa"]
        ))
        
        # FalkorDB rules
        self.add_rule(BusinessRule(
            id="falkor_graph_size",
            name="FalkorDB Graph Size Limit",
            condition="graph_nodes > 10000",
            action="optimize_query",
            service_scope=["falkor_db"]
        ))
        
        # Ollama rules
        self.add_rule(BusinessRule(
            id="ollama_response_length",
            name="Ollama Response Length Control",
            condition="response_length > 1000",
            action="summarize_response",
            service_scope=["ollama"]
        ))
        
        # ART rules
        self.add_rule(BusinessRule(
            id="art_processing_time",
            name="ART Processing Time Limit",
            condition="processing_time > 30",
            action="timeout_and_fallback",
            service_scope=["art"]
        ))
        
        # Lakehouse-GNN rules
        self.add_rule(BusinessRule(
            id="gnn_model_selection",
            name="GNN Model Selection",
            condition="data_size > 1000000",
            action="use_distributed_model",
            service_scope=["lakehouse_gnn"]
        ))
    
    def add_rule(self, rule: BusinessRule):
        """Add a business rule"""
        self.rules[rule.id] = rule
        logger.info(f"Added business rule: {rule.name}")
    
    def get_applicable_rules(self, service: str) -> List[BusinessRule]:
        """Get rules applicable to a specific service"""
        return [
            rule for rule in self.rules.values()
            if rule.enabled and (
                not rule.service_scope or service in rule.service_scope
            )
        ]
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for a service request"""
        applicable_rules = self.get_applicable_rules(service)
        actions = []
        
        for rule in applicable_rules:
            if await self._evaluate_condition(rule.condition, facts):
                actions.append({
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "action": rule.action,
                    "priority": rule.priority
                })
        
        # Sort by priority
        actions.sort(key=lambda x: x["priority"], reverse=True)
        
        return {
            "applicable_rules": len(applicable_rules),
            "triggered_actions": actions,
            "facts_evaluated": facts
        }
    
    async def _evaluate_condition(self, condition: str, facts: Dict[str, Any]) -> bool:
        """Evaluate a rule condition against facts"""
        try:
            # Simple condition evaluation (can be enhanced with proper parser)
            # For now, handle basic comparisons
            if "confidence <" in condition:
                threshold = float(condition.split("<")[1].strip())
                return facts.get("confidence", 1.0) < threshold
            elif "query_tokens >" in condition:
                threshold = int(condition.split(">")[1].strip())
                return facts.get("query_tokens", 0) > threshold
            elif "graph_nodes >" in condition:
                threshold = int(condition.split(">")[1].strip())
                return facts.get("graph_nodes", 0) > threshold
            elif "response_length >" in condition:
                threshold = int(condition.split(">")[1].strip())
                return facts.get("response_length", 0) > threshold
            elif "processing_time >" in condition:
                threshold = float(condition.split(">")[1].strip())
                return facts.get("processing_time", 0) > threshold
            elif "data_size >" in condition:
                threshold = int(condition.split(">")[1].strip())
                return facts.get("data_size", 0) > threshold
            
            return False
        except Exception as e:
            logger.error(f"Error evaluating condition '{condition}': {e}")
            return False

# Global rule engine
rule_engine = RuleEngine()

class AIMLServiceClient:
    """Client for AI/ML service integration"""
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def call_service(self, service: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Call an AI/ML service"""
        if service not in AI_ML_SERVICES:
            raise ValueError(f"Unknown service: {service}")
        
        url = AI_ML_SERVICES[service]
        
        try:
            async with self.session.post(
                url,
                json=data,
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    error_text = await response.text()
                    raise HTTPException(
                        status_code=response.status,
                        detail=f"Service {service} error: {error_text}"
                    )
        except aiohttp.ClientError as e:
            logger.error(f"Error calling service {service}: {e}")
            raise HTTPException(
                status_code=503,
                detail=f"Service {service} unavailable: {str(e)}"
            )

async def startup_event():
    """Initialize services on startup"""
    global redis_client
    
    try:
        redis_client = redis.from_url(REDIS_URL)
        await redis_client.ping()
        logger.info("Connected to Redis")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")
        redis_client = None
    
    logger.info("Business Rules Orchestrator started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("Business Rules Orchestrator stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "rule_engine": "active",
            "ai_ml_services": len(AI_ML_SERVICES)
        }
    }

@app.get("/rules")
async def get_rules():
    """Get all business rules"""
    return {
        "rules": [asdict(rule) for rule in rule_engine.rules.values()],
        "total": len(rule_engine.rules)
    }

@app.post("/rules")
async def add_rule(rule_data: Dict[str, Any]):
    """Add a new business rule"""
    try:
        rule = BusinessRule(**rule_data)
        rule_engine.add_rule(rule)
        return {"message": "Rule added successfully", "rule_id": rule.id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/reason", response_model=ReasoningResponse)
async def reason_with_rules(request: ReasoningRequest):
    """Execute reasoning with business rules"""
    start_time = datetime.utcnow()
    
    try:
        # Evaluate business rules first
        rule_evaluation = await rule_engine.evaluate_rules(
            request.service, 
            request.facts
        )
        
        # Apply rule actions
        modified_facts = request.facts.copy()
        reasoning_trace = [f"Evaluated {rule_evaluation['applicable_rules']} rules"]
        
        for action in rule_evaluation["triggered_actions"]:
            reasoning_trace.append(f"Applied rule: {action['rule_name']} -> {action['action']}")
            
            # Apply rule actions
            if action["action"] == "request_human_review":
                modified_facts["requires_human_review"] = True
            elif action["action"] == "split_query":
                modified_facts["split_query"] = True
            elif action["action"] == "optimize_query":
                modified_facts["optimize_query"] = True
            elif action["action"] == "summarize_response":
                modified_facts["summarize_response"] = True
            elif action["action"] == "timeout_and_fallback":
                modified_facts["timeout_limit"] = 30
            elif action["action"] == "use_distributed_model":
                modified_facts["use_distributed"] = True
        
        # Call AI/ML service with modified facts
        async with AIMLServiceClient() as client:
            service_response = await client.call_service(
                request.service,
                {
                    "data": modified_facts,
                    "context": request.context or {},
                    "rules_applied": rule_evaluation["triggered_actions"]
                }
            )
        
        # Calculate execution time
        execution_time = (datetime.utcnow() - start_time).total_seconds()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"reasoning:{request.service}:{hash(str(request.facts))}"
            await redis_client.setex(
                cache_key,
                300,  # 5 minutes
                json.dumps({
                    "response": service_response,
                    "rule_evaluation": rule_evaluation,
                    "timestamp": start_time.isoformat()
                })
            )
        
        return ReasoningResponse(
            service=request.service,
            conclusion=service_response,
            confidence=service_response.get("confidence", 0.0),
            reasoning_trace=reasoning_trace,
            execution_time=execution_time,
            timestamp=start_time
        )
        
    except Exception as e:
        logger.error(f"Reasoning error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/services/status")
async def get_services_status():
    """Get status of all AI/ML services"""
    statuses = []
    
    async with AIMLServiceClient() as client:
        for service_name, service_url in AI_ML_SERVICES.items():
            try:
                start_time = datetime.utcnow()
                async with client.session.get(
                    f"{service_url}/health",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    response_time = (datetime.utcnow() - start_time).total_seconds()
                    status = "healthy" if response.status == 200 else "unhealthy"
            except Exception:
                status = "unavailable"
                response_time = None
            
            statuses.append(ServiceStatus(
                service=service_name,
                status=status,
                last_check=datetime.utcnow(),
                response_time=response_time
            ))
    
    return {"services": statuses}

@app.post("/services/{service_name}/test")
async def test_service(service_name: str, test_data: Dict[str, Any]):
    """Test a specific AI/ML service"""
    if service_name not in AI_ML_SERVICES:
        raise HTTPException(status_code=404, detail="Service not found")
    
    try:
        async with AIMLServiceClient() as client:
            result = await client.call_service(service_name, test_data)
        
        return {
            "service": service_name,
            "test_result": result,
            "status": "success"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "rules_count": len(rule_engine.rules),
        "services_count": len(AI_ML_SERVICES),
        "cache_size": len(reasoning_cache),
        "uptime": datetime.utcnow(),
        "version": "2.0.0"
    }

if __name__ == "__main__":
    uvicorn.run(
        "business_rules_orchestrator:app",
        host="0.0.0.0",
        port=8086,
        reload=True,
        log_level="info"
    )

