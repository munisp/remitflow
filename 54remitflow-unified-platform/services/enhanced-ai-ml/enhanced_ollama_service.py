#!/usr/bin/env python3
"""
Enhanced Ollama Service with Business Rules Integration
Provides local LLM inference with rule-based response optimization
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, AsyncGenerator
from dataclasses import dataclass
import uuid

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import uvicorn

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Enhanced Ollama Service",
    description="Local LLM inference with business rules integration",
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
BUSINESS_RULES_URL = os.getenv("BUSINESS_RULES_URL", "http://localhost:8086")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

# Data Models
class ChatMessage(BaseModel):
    role: str = Field(..., description="Message role (user, assistant, system)")
    content: str = Field(..., description="Message content")
    timestamp: Optional[datetime] = Field(default_factory=datetime.utcnow)

class ChatRequest(BaseModel):
    model: str = Field("llama2", description="Model name")
    messages: List[ChatMessage] = Field(..., description="Chat messages")
    stream: bool = Field(False, description="Stream response")
    temperature: float = Field(0.7, description="Response temperature")
    max_tokens: int = Field(2048, description="Maximum tokens")
    context_window: int = Field(4096, description="Context window size")
    system_prompt: Optional[str] = Field(None, description="System prompt")

class ChatResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    model: str
    response: str
    tokens_used: int
    processing_time: float
    business_rules_applied: List[str]
    content_filtered: bool
    confidence_score: float
    timestamp: datetime

class ModelInfo(BaseModel):
    name: str
    size: str
    family: str
    parameter_count: str
    quantization: str
    status: str

class ServiceStatus(BaseModel):
    status: str
    ollama_connected: bool
    available_models: List[str]
    last_request: Optional[datetime] = None
    total_requests: int = 0

# Global state
redis_client: Optional[redis.Redis] = None
request_count = 0
last_request_time: Optional[datetime] = None

class OllamaClient:
    """Client for Ollama API integration"""
    
    def __init__(self, base_url: str = OLLAMA_URL):
        self.base_url = base_url
        self.available_models = []
        self.connected = False
    
    async def check_connection(self) -> bool:
        """Check if Ollama is available"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=5)) as response:
                    if response.status == 200:
                        data = await response.json()
                        self.available_models = [model["name"] for model in data.get("models", [])]
                        self.connected = True
                        return True
        except Exception as e:
            logger.warning(f"Ollama connection failed: {e}")
            self.connected = False
        return False
    
    async def generate_response(self, request: ChatRequest) -> Dict[str, Any]:
        """Generate response using Ollama"""
        try:
            # Prepare Ollama request
            ollama_request = {
                "model": request.model,
                "prompt": self._format_messages_as_prompt(request.messages),
                "stream": False,
                "options": {
                    "temperature": request.temperature,
                    "num_predict": request.max_tokens,
                    "num_ctx": request.context_window
                }
            }
            
            if request.system_prompt:
                ollama_request["system"] = request.system_prompt
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate",
                    json=ollama_request,
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        return {
                            "response": data.get("response", ""),
                            "tokens_used": data.get("eval_count", 0),
                            "success": True
                        }
                    else:
                        return {
                            "response": f"Error: HTTP {response.status}",
                            "tokens_used": 0,
                            "success": False
                        }
        except Exception as e:
            logger.error(f"Ollama generation error: {e}")
            return {
                "response": f"Error: {str(e)}",
                "tokens_used": 0,
                "success": False
            }
    
    async def stream_response(self, request: ChatRequest) -> AsyncGenerator[str, None]:
        """Stream response using Ollama"""
        try:
            # Prepare Ollama request
            ollama_request = {
                "model": request.model,
                "prompt": self._format_messages_as_prompt(request.messages),
                "stream": True,
                "options": {
                    "temperature": request.temperature,
                    "num_predict": request.max_tokens,
                    "num_ctx": request.context_window
                }
            }
            
            if request.system_prompt:
                ollama_request["system"] = request.system_prompt
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/api/generate",
                    json=ollama_request,
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as response:
                    if response.status == 200:
                        async for line in response.content:
                            if line:
                                try:
                                    data = json.loads(line.decode('utf-8'))
                                    if "response" in data:
                                        yield data["response"]
                                except json.JSONDecodeError:
                                    continue
                    else:
                        yield f"Error: HTTP {response.status}"
        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            yield f"Error: {str(e)}"
    
    def _format_messages_as_prompt(self, messages: List[ChatMessage]) -> str:
        """Format chat messages as a single prompt"""
        prompt_parts = []
        
        for message in messages:
            if message.role == "system":
                prompt_parts.append(f"System: {message.content}")
            elif message.role == "user":
                prompt_parts.append(f"Human: {message.content}")
            elif message.role == "assistant":
                prompt_parts.append(f"Assistant: {message.content}")
        
        prompt_parts.append("Assistant:")
        return "\n\n".join(prompt_parts)
    
    async def get_models(self) -> List[ModelInfo]:
        """Get available models"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.base_url}/api/tags", timeout=aiohttp.ClientTimeout(total=10)) as response:
                    if response.status == 200:
                        data = await response.json()
                        models = []
                        for model_data in data.get("models", []):
                            models.append(ModelInfo(
                                name=model_data.get("name", "unknown"),
                                size=model_data.get("size", "unknown"),
                                family=model_data.get("details", {}).get("family", "unknown"),
                                parameter_count=model_data.get("details", {}).get("parameter_size", "unknown"),
                                quantization=model_data.get("details", {}).get("quantization_level", "unknown"),
                                status="available"
                            ))
                        return models
        except Exception as e:
            logger.error(f"Failed to get models: {e}")
        return []

class ContentFilter:
    """Content filtering and safety checks"""
    
    def __init__(self):
        self.blocked_patterns = [
            "password", "credit card", "ssn", "social security",
            "bank account", "routing number", "pin code"
        ]
        self.financial_sensitive_terms = [
            "account number", "balance", "transaction", "transfer",
            "payment", "withdrawal", "deposit"
        ]
    
    def filter_request(self, content: str) -> Tuple[bool, str]:
        """Filter incoming request content"""
        content_lower = content.lower()
        
        # Check for blocked patterns
        for pattern in self.blocked_patterns:
            if pattern in content_lower:
                return True, f"Content contains sensitive information: {pattern}"
        
        return False, ""
    
    def filter_response(self, content: str) -> Tuple[bool, str]:
        """Filter outgoing response content"""
        content_lower = content.lower()
        
        # Check for financial sensitive information
        for term in self.financial_sensitive_terms:
            if term in content_lower and any(char.isdigit() for char in content):
                return True, f"Response may contain sensitive financial data"
        
        return False, ""
    
    def calculate_confidence(self, request: str, response: str) -> float:
        """Calculate confidence score for the response"""
        base_confidence = 0.8
        
        # Reduce confidence for very short responses
        if len(response) < 50:
            base_confidence -= 0.2
        
        # Reduce confidence for responses with potential errors
        if "error" in response.lower() or "sorry" in response.lower():
            base_confidence -= 0.3
        
        # Increase confidence for detailed responses
        if len(response) > 200:
            base_confidence += 0.1
        
        return max(min(base_confidence, 1.0), 0.1)

class BusinessRulesClient:
    """Client for business rules service integration"""
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for Ollama operations"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{BUSINESS_RULES_URL}/reason",
                    json={
                        "service": service,
                        "facts": facts,
                        "method": "deduction"
                    },
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        logger.warning(f"Business rules service error: {response.status}")
                        return {"conclusion": {}, "reasoning_trace": []}
        except Exception as e:
            logger.warning(f"Failed to connect to business rules service: {e}")
            return {"conclusion": {}, "reasoning_trace": []}

# Global instances
ollama_client = OllamaClient()
content_filter = ContentFilter()
rules_client = BusinessRulesClient()

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
    
    # Check Ollama connection
    await ollama_client.check_connection()
    if ollama_client.connected:
        logger.info(f"Connected to Ollama with {len(ollama_client.available_models)} models")
    else:
        logger.warning("Ollama connection failed")
    
    logger.info("Enhanced Ollama service started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("Enhanced Ollama service stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "ollama_connected": ollama_client.connected,
        "available_models": len(ollama_client.available_models),
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "ollama": "connected" if ollama_client.connected else "disconnected",
            "business_rules": "available"
        }
    }

@app.get("/status", response_model=ServiceStatus)
async def get_status():
    """Get service status"""
    return ServiceStatus(
        status="active" if ollama_client.connected else "inactive",
        ollama_connected=ollama_client.connected,
        available_models=ollama_client.available_models,
        last_request=last_request_time,
        total_requests=request_count
    )

@app.post("/chat", response_model=ChatResponse)
async def chat_completion(request: ChatRequest):
    """Generate chat completion"""
    global request_count, last_request_time
    
    if not ollama_client.connected:
        raise HTTPException(status_code=503, detail="Ollama service not available")
    
    if request.model not in ollama_client.available_models:
        raise HTTPException(status_code=400, detail=f"Model {request.model} not available")
    
    start_time = time.time()
    
    try:
        # Get last user message for filtering
        user_messages = [msg for msg in request.messages if msg.role == "user"]
        last_user_message = user_messages[-1].content if user_messages else ""
        
        # Filter request content
        is_filtered, filter_reason = content_filter.filter_request(last_user_message)
        if is_filtered:
            raise HTTPException(status_code=400, detail=f"Content filtered: {filter_reason}")
        
        # Prepare facts for business rules evaluation
        chat_facts = {
            "model": request.model,
            "message_count": len(request.messages),
            "total_tokens": sum(len(msg.content.split()) for msg in request.messages),
            "temperature": request.temperature,
            "max_tokens": request.max_tokens,
            "has_system_prompt": request.system_prompt is not None,
            "stream_requested": request.stream,
            "message_length": len(last_user_message)
        }
        
        # Evaluate business rules
        rules_result = await rules_client.evaluate_rules("ollama_service", chat_facts)
        
        # Apply business rules conclusions
        adjust_temperature = rules_result.get("conclusion", {}).get("adjust_temperature", False)
        limit_tokens = rules_result.get("conclusion", {}).get("limit_tokens", False)
        
        # Adjust parameters based on rules
        if adjust_temperature:
            request.temperature = min(request.temperature, 0.5)  # Lower temperature for more focused responses
        
        if limit_tokens:
            request.max_tokens = min(request.max_tokens, 1024)  # Limit token usage
        
        # Generate response
        result = await ollama_client.generate_response(request)
        
        if not result["success"]:
            raise HTTPException(status_code=500, detail=result["response"])
        
        response_text = result["response"]
        
        # Filter response content
        is_response_filtered, response_filter_reason = content_filter.filter_response(response_text)
        if is_response_filtered:
            response_text = "I cannot provide that information as it may contain sensitive data."
        
        # Calculate confidence score
        confidence_score = content_filter.calculate_confidence(last_user_message, response_text)
        
        # Calculate processing time
        processing_time = time.time() - start_time
        
        # Update global counters
        request_count += 1
        last_request_time = datetime.utcnow()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"ollama_chat:{hash(str(request.dict()))}"
            cache_data = {
                "response": response_text,
                "tokens_used": result["tokens_used"],
                "processing_time": processing_time,
                "timestamp": last_request_time.isoformat()
            }
            await redis_client.setex(cache_key, 300, json.dumps(cache_data))
        
        return ChatResponse(
            model=request.model,
            response=response_text,
            tokens_used=result["tokens_used"],
            processing_time=processing_time,
            business_rules_applied=rules_result.get("reasoning_trace", []),
            content_filtered=is_response_filtered,
            confidence_score=confidence_score,
            timestamp=last_request_time
        )
        
    except Exception as e:
        logger.error(f"Chat completion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat/stream")
async def chat_completion_stream(request: ChatRequest):
    """Generate streaming chat completion"""
    global request_count, last_request_time
    
    if not ollama_client.connected:
        raise HTTPException(status_code=503, detail="Ollama service not available")
    
    if request.model not in ollama_client.available_models:
        raise HTTPException(status_code=400, detail=f"Model {request.model} not available")
    
    # Update counters
    request_count += 1
    last_request_time = datetime.utcnow()
    
    async def generate_stream():
        try:
            async for chunk in ollama_client.stream_response(request):
                yield f"data: {json.dumps({'content': chunk})}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
    
    return StreamingResponse(
        generate_stream(),
        media_type="text/plain",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"}
    )

@app.get("/models")
async def get_models():
    """Get available models"""
    if not ollama_client.connected:
        raise HTTPException(status_code=503, detail="Ollama service not available")
    
    models = await ollama_client.get_models()
    return {
        "models": models,
        "total": len(models)
    }

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "total_requests": request_count,
        "last_request": last_request_time,
        "ollama_connected": ollama_client.connected,
        "available_models": len(ollama_client.available_models),
        "version": "2.0.0"
    }

@app.post("/test")
async def test_service():
    """Test service with sample chat"""
    if not ollama_client.connected:
        raise HTTPException(status_code=503, detail="Ollama service not available")
    
    # Create test request
    test_request = ChatRequest(
        model=ollama_client.available_models[0] if ollama_client.available_models else "llama2",
        messages=[
            ChatMessage(role="user", content="Hello, can you help me with banking questions?")
        ],
        temperature=0.7,
        max_tokens=100
    )
    
    # Generate test response
    result = await chat_completion(test_request)
    
    return {
        "test_status": "success",
        "result": result
    }

if __name__ == "__main__":
    uvicorn.run(
        "enhanced_ollama_service:app",
        host="0.0.0.0",
        port=8091,
        reload=True,
        log_level="info"
    )

