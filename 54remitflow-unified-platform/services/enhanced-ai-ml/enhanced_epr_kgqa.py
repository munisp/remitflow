#!/usr/bin/env python3
"""
Enhanced EPR-KGQA Service with Business Rules Integration
Provides knowledge graph question answering with rule-based query optimization
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import re

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import networkx as nx
import spacy

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Enhanced EPR-KGQA Service",
    description="Knowledge Graph Question Answering with business rules integration",
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

# Data Models
class KGQARequest(BaseModel):
    question: str = Field(..., description="Natural language question")
    context: Optional[Dict[str, Any]] = Field(None, description="Additional context")
    max_results: int = Field(10, description="Maximum number of results")
    confidence_threshold: float = Field(0.7, description="Confidence threshold")
    reasoning_depth: int = Field(3, description="Maximum reasoning depth")

class KGEntity(BaseModel):
    id: str
    label: str
    type: str
    properties: Dict[str, Any]
    confidence: float

class KGRelation(BaseModel):
    source: str
    target: str
    relation_type: str
    properties: Dict[str, Any]
    confidence: float

class KGQAResponse(BaseModel):
    question: str
    answer: str
    entities: List[KGEntity]
    relations: List[KGRelation]
    reasoning_path: List[str]
    confidence: float
    query_complexity: int
    processing_time: float
    business_rules_applied: List[str]
    requires_clarification: bool
    timestamp: datetime

class ServiceStatus(BaseModel):
    status: str
    knowledge_graph_loaded: bool
    nlp_model_loaded: bool
    last_query: Optional[datetime] = None
    total_queries: int = 0

# Global state
redis_client: Optional[redis.Redis] = None
nlp_model = None
knowledge_graph = None
query_count = 0
last_query_time: Optional[datetime] = None

@dataclass
class KnowledgeGraph:
    """Enhanced Knowledge Graph for financial domain"""
    
    def __init__(self):
        self.graph = nx.MultiDiGraph()
        self.entity_index = {}
        self.relation_index = {}
        self.loaded = False
        self._initialize_financial_kg()
    
    def _initialize_financial_kg(self):
        """Initialize knowledge graph with financial entities and relations"""
        
        # Financial entities
        financial_entities = [
            {"id": "bank_001", "label": "First Bank of Nigeria", "type": "Bank", 
             "properties": {"established": 1894, "headquarters": "Lagos", "type": "commercial"}},
            {"id": "bank_002", "label": "Zenith Bank", "type": "Bank",
             "properties": {"established": 1990, "headquarters": "Lagos", "type": "commercial"}},
            {"id": "bank_003", "label": "Access Bank", "type": "Bank",
             "properties": {"established": 1989, "headquarters": "Lagos", "type": "commercial"}},
            {"id": "service_001", "label": "Mobile Banking", "type": "Service",
             "properties": {"category": "digital", "availability": "24/7"}},
            {"id": "service_002", "label": "ATM Services", "type": "Service",
             "properties": {"category": "physical", "availability": "24/7"}},
            {"id": "service_003", "label": "Internet Banking", "type": "Service",
             "properties": {"category": "digital", "availability": "24/7"}},
            {"id": "product_001", "label": "Savings Account", "type": "Product",
             "properties": {"category": "deposit", "minimum_balance": 1000}},
            {"id": "product_002", "label": "Current Account", "type": "Product",
             "properties": {"category": "deposit", "minimum_balance": 5000}},
            {"id": "product_003", "label": "Fixed Deposit", "type": "Product",
             "properties": {"category": "investment", "minimum_amount": 50000}},
            {"id": "regulation_001", "label": "CBN Guidelines", "type": "Regulation",
             "properties": {"authority": "Central Bank of Nigeria", "scope": "banking"}},
            {"id": "regulation_002", "label": "NDPR", "type": "Regulation",
             "properties": {"authority": "NITDA", "scope": "data_protection"}},
            {"id": "customer_001", "label": "Individual Customer", "type": "CustomerType",
             "properties": {"category": "retail", "requirements": "basic_kyc"}},
            {"id": "customer_002", "label": "Corporate Customer", "type": "CustomerType",
             "properties": {"category": "corporate", "requirements": "enhanced_kyc"}},
        ]
        
        # Add entities to graph
        for entity in financial_entities:
            self.graph.add_node(entity["id"], **entity)
            self.entity_index[entity["label"].lower()] = entity["id"]
        
        # Financial relations
        financial_relations = [
            ("bank_001", "service_001", "offers", {"since": 2010}),
            ("bank_001", "service_002", "offers", {"since": 1990}),
            ("bank_001", "product_001", "provides", {"since": 1894}),
            ("bank_002", "service_001", "offers", {"since": 2008}),
            ("bank_002", "service_003", "offers", {"since": 2005}),
            ("bank_002", "product_002", "provides", {"since": 1990}),
            ("bank_003", "service_001", "offers", {"since": 2012}),
            ("bank_003", "product_003", "provides", {"since": 2000}),
            ("regulation_001", "bank_001", "regulates", {"compliance_required": True}),
            ("regulation_001", "bank_002", "regulates", {"compliance_required": True}),
            ("regulation_002", "service_001", "applies_to", {"data_protection": True}),
            ("customer_001", "product_001", "eligible_for", {"requirements": "basic_kyc"}),
            ("customer_002", "product_003", "eligible_for", {"requirements": "enhanced_kyc"}),
        ]
        
        # Add relations to graph
        for source, target, relation_type, properties in financial_relations:
            self.graph.add_edge(source, target, relation=relation_type, **properties)
            relation_key = f"{relation_type}_{source}_{target}"
            self.relation_index[relation_key] = (source, target, relation_type)
        
        self.loaded = True
        logger.info(f"Knowledge graph initialized with {len(self.graph.nodes)} entities and {len(self.graph.edges)} relations")
    
    def find_entities(self, query_text: str) -> List[KGEntity]:
        """Find entities mentioned in query text"""
        entities = []
        query_lower = query_text.lower()
        
        for label, entity_id in self.entity_index.items():
            if label in query_lower:
                node_data = self.graph.nodes[entity_id]
                entities.append(KGEntity(
                    id=entity_id,
                    label=node_data["label"],
                    type=node_data["type"],
                    properties=node_data.get("properties", {}),
                    confidence=0.9  # High confidence for exact matches
                ))
        
        return entities
    
    def find_relations(self, source_entities: List[str], target_entities: List[str] = None) -> List[KGRelation]:
        """Find relations between entities"""
        relations = []
        
        for source_id in source_entities:
            if source_id in self.graph:
                for target_id in self.graph.successors(source_id):
                    if target_entities is None or target_id in target_entities:
                        edge_data = self.graph.get_edge_data(source_id, target_id)
                        for edge_key, edge_attrs in edge_data.items():
                            relations.append(KGRelation(
                                source=source_id,
                                target=target_id,
                                relation_type=edge_attrs.get("relation", "unknown"),
                                properties={k: v for k, v in edge_attrs.items() if k != "relation"},
                                confidence=0.8
                            ))
        
        return relations
    
    def shortest_path_reasoning(self, source_entities: List[str], target_entities: List[str]) -> List[str]:
        """Find reasoning path between entities"""
        reasoning_paths = []
        
        for source in source_entities:
            for target in target_entities:
                try:
                    path = nx.shortest_path(self.graph.to_undirected(), source, target)
                    path_description = " -> ".join([
                        self.graph.nodes[node]["label"] for node in path
                    ])
                    reasoning_paths.append(path_description)
                except nx.NetworkXNoPath:
                    continue
        
        return reasoning_paths

# Global knowledge graph
kg = KnowledgeGraph()

class NLPProcessor:
    """Natural Language Processing for query understanding"""
    
    def __init__(self):
        self.nlp = None
        self.loaded = False
    
    def load_model(self):
        """Load spaCy NLP model"""
        try:
            # Try to load English model
            self.nlp = spacy.load("en_core_web_sm")
            self.loaded = True
            logger.info("spaCy NLP model loaded successfully")
        except OSError:
            # Fallback to basic processing
            logger.warning("spaCy model not found, using basic processing")
            self.loaded = False
    
    def extract_entities(self, text: str) -> List[str]:
        """Extract named entities from text"""
        if self.loaded and self.nlp:
            doc = self.nlp(text)
            return [ent.text for ent in doc.ents]
        else:
            # Basic entity extraction using patterns
            entities = []
            # Look for capitalized words (potential entities)
            words = re.findall(r'\b[A-Z][a-z]+\b', text)
            entities.extend(words)
            return entities
    
    def analyze_question_type(self, question: str) -> str:
        """Analyze the type of question"""
        question_lower = question.lower()
        
        if any(word in question_lower for word in ["what", "which"]):
            return "factual"
        elif any(word in question_lower for word in ["how", "why"]):
            return "explanatory"
        elif any(word in question_lower for word in ["when", "where"]):
            return "temporal_spatial"
        elif any(word in question_lower for word in ["who"]):
            return "entity_focused"
        else:
            return "general"
    
    def calculate_complexity(self, question: str) -> int:
        """Calculate question complexity"""
        complexity = 1
        
        # Count question words
        question_words = ["what", "which", "how", "why", "when", "where", "who"]
        complexity += sum(1 for word in question_words if word in question.lower())
        
        # Count conjunctions (indicates complex queries)
        conjunctions = ["and", "or", "but", "however", "also"]
        complexity += sum(1 for conj in conjunctions if conj in question.lower())
        
        # Count words (longer questions are more complex)
        word_count = len(question.split())
        if word_count > 20:
            complexity += 2
        elif word_count > 10:
            complexity += 1
        
        return min(complexity, 10)  # Cap at 10

# Global NLP processor
nlp_processor = NLPProcessor()

class BusinessRulesClient:
    """Client for business rules service integration"""
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for KGQA"""
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

# Global business rules client
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
    
    # Load NLP model
    nlp_processor.load_model()
    
    logger.info("Enhanced EPR-KGQA service started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("Enhanced EPR-KGQA service stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "knowledge_graph_loaded": kg.loaded,
        "nlp_model_loaded": nlp_processor.loaded,
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "knowledge_graph": "loaded" if kg.loaded else "not_loaded",
            "nlp_processor": "loaded" if nlp_processor.loaded else "not_loaded"
        }
    }

@app.get("/status", response_model=ServiceStatus)
async def get_status():
    """Get service status"""
    return ServiceStatus(
        status="active" if kg.loaded else "inactive",
        knowledge_graph_loaded=kg.loaded,
        nlp_model_loaded=nlp_processor.loaded,
        last_query=last_query_time,
        total_queries=query_count
    )

@app.post("/query", response_model=KGQAResponse)
async def answer_question(request: KGQARequest):
    """Answer question using knowledge graph"""
    global query_count, last_query_time
    
    if not kg.loaded:
        raise HTTPException(status_code=503, detail="Knowledge graph not loaded")
    
    start_time = time.time()
    
    try:
        # Analyze question complexity
        question_complexity = nlp_processor.calculate_complexity(request.question)
        question_type = nlp_processor.analyze_question_type(request.question)
        
        # Extract entities from question
        extracted_entities = nlp_processor.extract_entities(request.question)
        
        # Prepare facts for business rules evaluation
        query_facts = {
            "question_length": len(request.question),
            "question_complexity": question_complexity,
            "question_type": question_type,
            "extracted_entities_count": len(extracted_entities),
            "confidence_threshold": request.confidence_threshold,
            "reasoning_depth": request.reasoning_depth,
            "query_tokens": len(request.question.split())
        }
        
        # Evaluate business rules
        rules_result = await rules_client.evaluate_rules("epr_kgqa", query_facts)
        
        # Apply business rules conclusions
        requires_clarification = rules_result.get("conclusion", {}).get("requires_clarification", False)
        split_query = rules_result.get("conclusion", {}).get("split_query", False)
        
        # Find entities in knowledge graph
        kg_entities = kg.find_entities(request.question)
        
        # If no entities found, try extracted entities
        if not kg_entities and extracted_entities:
            for entity_text in extracted_entities:
                entity_matches = kg.find_entities(entity_text)
                kg_entities.extend(entity_matches)
        
        # Find relations between entities
        entity_ids = [entity.id for entity in kg_entities]
        kg_relations = kg.find_relations(entity_ids)
        
        # Generate reasoning path
        reasoning_path = []
        if len(entity_ids) >= 2:
            paths = kg.shortest_path_reasoning(entity_ids[:1], entity_ids[1:])
            reasoning_path.extend(paths)
        
        # Generate answer based on found entities and relations
        answer = generate_answer(request.question, kg_entities, kg_relations, reasoning_path)
        
        # Calculate confidence based on entities found and relations
        confidence = calculate_confidence(kg_entities, kg_relations, question_complexity)
        
        # Calculate processing time
        processing_time = time.time() - start_time
        
        # Update global counters
        query_count += 1
        last_query_time = datetime.utcnow()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"kgqa:{hash(request.question)}"
            cache_data = {
                "answer": answer,
                "entities": [entity.dict() for entity in kg_entities],
                "relations": [relation.dict() for relation in kg_relations],
                "confidence": confidence,
                "timestamp": last_query_time.isoformat()
            }
            await redis_client.setex(cache_key, 300, json.dumps(cache_data))
        
        return KGQAResponse(
            question=request.question,
            answer=answer,
            entities=kg_entities,
            relations=kg_relations,
            reasoning_path=reasoning_path,
            confidence=confidence,
            query_complexity=question_complexity,
            processing_time=processing_time,
            business_rules_applied=rules_result.get("reasoning_trace", []),
            requires_clarification=requires_clarification,
            timestamp=last_query_time
        )
        
    except Exception as e:
        logger.error(f"KGQA error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

def generate_answer(question: str, entities: List[KGEntity], relations: List[KGRelation], reasoning_path: List[str]) -> str:
    """Generate natural language answer"""
    if not entities:
        return "I couldn't find any relevant information in the knowledge graph to answer your question."
    
    # Simple answer generation based on entities and relations
    if len(entities) == 1:
        entity = entities[0]
        answer = f"Based on the knowledge graph, {entity.label} is a {entity.type}"
        
        if entity.properties:
            properties_text = ", ".join([f"{k}: {v}" for k, v in entity.properties.items()])
            answer += f" with properties: {properties_text}"
        
        # Add relation information
        if relations:
            relation_texts = []
            for relation in relations[:3]:  # Limit to first 3 relations
                relation_texts.append(f"{relation.relation_type} {relation.target}")
            answer += f". It {', '.join(relation_texts)}"
        
        return answer + "."
    
    elif len(entities) > 1:
        entity_names = [entity.label for entity in entities]
        answer = f"I found information about: {', '.join(entity_names)}"
        
        if relations:
            answer += f". These entities are connected through {len(relations)} relationships"
        
        if reasoning_path:
            answer += f". Reasoning path: {reasoning_path[0]}"
        
        return answer + "."
    
    return "I found some information but couldn't generate a comprehensive answer."

def calculate_confidence(entities: List[KGEntity], relations: List[KGRelation], complexity: int) -> float:
    """Calculate confidence score for the answer"""
    base_confidence = 0.5
    
    # Increase confidence based on entities found
    if entities:
        entity_confidence = min(len(entities) * 0.2, 0.4)
        base_confidence += entity_confidence
    
    # Increase confidence based on relations found
    if relations:
        relation_confidence = min(len(relations) * 0.1, 0.3)
        base_confidence += relation_confidence
    
    # Decrease confidence for complex questions
    complexity_penalty = min(complexity * 0.05, 0.2)
    base_confidence -= complexity_penalty
    
    return max(min(base_confidence, 1.0), 0.1)

@app.get("/entities")
async def get_entities():
    """Get all entities in knowledge graph"""
    if not kg.loaded:
        raise HTTPException(status_code=503, detail="Knowledge graph not loaded")
    
    entities = []
    for node_id, node_data in kg.graph.nodes(data=True):
        entities.append({
            "id": node_id,
            "label": node_data["label"],
            "type": node_data["type"],
            "properties": node_data.get("properties", {})
        })
    
    return {"entities": entities, "total": len(entities)}

@app.get("/relations")
async def get_relations():
    """Get all relations in knowledge graph"""
    if not kg.loaded:
        raise HTTPException(status_code=503, detail="Knowledge graph not loaded")
    
    relations = []
    for source, target, edge_data in kg.graph.edges(data=True):
        relations.append({
            "source": source,
            "target": target,
            "relation_type": edge_data.get("relation", "unknown"),
            "properties": {k: v for k, v in edge_data.items() if k != "relation"}
        })
    
    return {"relations": relations, "total": len(relations)}

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "total_queries": query_count,
        "last_query": last_query_time,
        "knowledge_graph_loaded": kg.loaded,
        "nlp_model_loaded": nlp_processor.loaded,
        "entities_count": len(kg.graph.nodes) if kg.loaded else 0,
        "relations_count": len(kg.graph.edges) if kg.loaded else 0,
        "version": "2.0.0"
    }

@app.post("/test")
async def test_service():
    """Test service with sample query"""
    if not kg.loaded:
        raise HTTPException(status_code=503, detail="Knowledge graph not loaded")
    
    # Create test request
    request = KGQARequest(
        question="What services does First Bank of Nigeria offer?",
        confidence_threshold=0.7,
        reasoning_depth=3
    )
    
    # Process test query
    result = await answer_question(request)
    
    return {
        "test_status": "success",
        "result": result
    }

if __name__ == "__main__":
    uvicorn.run(
        "enhanced_epr_kgqa:app",
        host="0.0.0.0",
        port=8088,
        reload=True,
        log_level="info"
    )

