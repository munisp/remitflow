#!/usr/bin/env python3
"""
Enhanced FalkorDB Service with Business Rules Integration
Provides graph database operations with rule-based query optimization
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass
import uuid

import aiohttp
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn
import networkx as nx

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="Enhanced FalkorDB Service",
    description="Graph database operations with business rules integration",
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
class GraphNode(BaseModel):
    id: str = Field(..., description="Node ID")
    label: str = Field(..., description="Node label")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Node properties")

class GraphEdge(BaseModel):
    source: str = Field(..., description="Source node ID")
    target: str = Field(..., description="Target node ID")
    relationship: str = Field(..., description="Relationship type")
    properties: Dict[str, Any] = Field(default_factory=dict, description="Edge properties")

class GraphQuery(BaseModel):
    query_type: str = Field(..., description="Type of query (cypher, pattern, traversal)")
    query: str = Field(..., description="Query string")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Query parameters")
    limit: int = Field(100, description="Result limit")
    timeout: int = Field(30, description="Query timeout in seconds")

class GraphQueryResult(BaseModel):
    nodes: List[GraphNode]
    edges: List[GraphEdge]
    query_time: float
    result_count: int
    business_rules_applied: List[str]
    optimized_query: str
    timestamp: datetime

class GraphStats(BaseModel):
    total_nodes: int
    total_edges: int
    node_types: Dict[str, int]
    edge_types: Dict[str, int]
    last_updated: datetime

# Global state
redis_client: Optional[redis.Redis] = None
graph_db = None
query_count = 0
last_query_time: Optional[datetime] = None

@dataclass
class FalkorGraphDB:
    """Enhanced graph database for financial domain"""
    
    def __init__(self):
        self.graph = nx.MultiDiGraph()
        self.node_index = {}
        self.edge_index = {}
        self.loaded = False
        self._initialize_financial_graph()
    
    def _initialize_financial_graph(self):
        """Initialize graph with financial entities and relationships"""
        
        # Financial institutions
        banks = [
            {"id": "bank_001", "label": "First Bank", "type": "Bank", 
             "properties": {"established": 1894, "assets": 8500000000000, "branches": 750}},
            {"id": "bank_002", "label": "Zenith Bank", "type": "Bank",
             "properties": {"established": 1990, "assets": 7200000000000, "branches": 500}},
            {"id": "bank_003", "label": "Access Bank", "type": "Bank",
             "properties": {"established": 1989, "assets": 9100000000000, "branches": 600}},
            {"id": "bank_004", "label": "GTBank", "type": "Bank",
             "properties": {"established": 1990, "assets": 5800000000000, "branches": 400}},
            {"id": "bank_005", "label": "UBA", "type": "Bank",
             "properties": {"established": 1961, "assets": 6900000000000, "branches": 1000}},
        ]
        
        # Customers
        customers = [
            {"id": "cust_001", "label": "John Doe", "type": "Individual",
             "properties": {"age": 35, "income": 2400000, "risk_score": 0.2}},
            {"id": "cust_002", "label": "Jane Smith", "type": "Individual",
             "properties": {"age": 28, "income": 1800000, "risk_score": 0.1}},
            {"id": "cust_003", "label": "ABC Corp", "type": "Corporate",
             "properties": {"employees": 500, "revenue": 5000000000, "risk_score": 0.3}},
            {"id": "cust_004", "label": "XYZ Ltd", "type": "Corporate",
             "properties": {"employees": 200, "revenue": 1200000000, "risk_score": 0.15}},
        ]
        
        # Accounts
        accounts = [
            {"id": "acc_001", "label": "Savings Account", "type": "Account",
             "properties": {"balance": 500000, "account_type": "savings", "status": "active"}},
            {"id": "acc_002", "label": "Current Account", "type": "Account",
             "properties": {"balance": 2500000, "account_type": "current", "status": "active"}},
            {"id": "acc_003", "label": "Corporate Account", "type": "Account",
             "properties": {"balance": 50000000, "account_type": "corporate", "status": "active"}},
            {"id": "acc_004", "label": "Fixed Deposit", "type": "Account",
             "properties": {"balance": 10000000, "account_type": "fixed_deposit", "status": "active"}},
        ]
        
        # Transactions
        transactions = [
            {"id": "txn_001", "label": "Transfer", "type": "Transaction",
             "properties": {"amount": 100000, "timestamp": "2025-08-30T10:00:00", "status": "completed"}},
            {"id": "txn_002", "label": "Deposit", "type": "Transaction",
             "properties": {"amount": 250000, "timestamp": "2025-08-30T11:00:00", "status": "completed"}},
            {"id": "txn_003", "label": "Withdrawal", "type": "Transaction",
             "properties": {"amount": 50000, "timestamp": "2025-08-30T12:00:00", "status": "completed"}},
        ]
        
        # Add all nodes
        all_nodes = banks + customers + accounts + transactions
        for node in all_nodes:
            self.graph.add_node(node["id"], **node)
            self.node_index[node["label"].lower()] = node["id"]
        
        # Relationships
        relationships = [
            # Customer-Bank relationships
            ("cust_001", "bank_001", "CUSTOMER_OF", {"since": "2020-01-01", "relationship_type": "primary"}),
            ("cust_002", "bank_002", "CUSTOMER_OF", {"since": "2021-03-15", "relationship_type": "primary"}),
            ("cust_003", "bank_003", "CUSTOMER_OF", {"since": "2019-06-01", "relationship_type": "corporate"}),
            ("cust_004", "bank_001", "CUSTOMER_OF", {"since": "2022-01-01", "relationship_type": "corporate"}),
            
            # Customer-Account relationships
            ("cust_001", "acc_001", "OWNS", {"opened": "2020-01-01", "primary": True}),
            ("cust_002", "acc_002", "OWNS", {"opened": "2021-03-15", "primary": True}),
            ("cust_003", "acc_003", "OWNS", {"opened": "2019-06-01", "primary": True}),
            ("cust_004", "acc_004", "OWNS", {"opened": "2022-01-01", "primary": True}),
            
            # Account-Bank relationships
            ("acc_001", "bank_001", "HELD_AT", {"account_number": "1234567890"}),
            ("acc_002", "bank_002", "HELD_AT", {"account_number": "2345678901"}),
            ("acc_003", "bank_003", "HELD_AT", {"account_number": "3456789012"}),
            ("acc_004", "bank_001", "HELD_AT", {"account_number": "4567890123"}),
            
            # Transaction relationships
            ("txn_001", "acc_001", "FROM", {"role": "source"}),
            ("txn_001", "acc_002", "TO", {"role": "destination"}),
            ("txn_002", "acc_002", "TO", {"role": "destination"}),
            ("txn_003", "acc_001", "FROM", {"role": "source"}),
            
            # Bank interconnections
            ("bank_001", "bank_002", "CORRESPONDENT", {"type": "clearing", "established": "2010"}),
            ("bank_002", "bank_003", "CORRESPONDENT", {"type": "clearing", "established": "2015"}),
            ("bank_003", "bank_004", "CORRESPONDENT", {"type": "settlement", "established": "2018"}),
        ]
        
        # Add relationships
        for source, target, rel_type, properties in relationships:
            self.graph.add_edge(source, target, relationship=rel_type, **properties)
            edge_key = f"{rel_type}_{source}_{target}"
            self.edge_index[edge_key] = (source, target, rel_type)
        
        self.loaded = True
        logger.info(f"FalkorDB initialized with {len(self.graph.nodes)} nodes and {len(self.graph.edges)} edges")
    
    def execute_cypher_query(self, query: str, parameters: Dict[str, Any] = None) -> Tuple[List[GraphNode], List[GraphEdge]]:
        """Execute Cypher-like query (simplified implementation)"""
        nodes = []
        edges = []
        
        # Simple pattern matching for demonstration
        if "MATCH" in query.upper():
            if "Customer" in query:
                # Return customer nodes
                for node_id, node_data in self.graph.nodes(data=True):
                    if node_data.get("type") in ["Individual", "Corporate"]:
                        nodes.append(GraphNode(
                            id=node_id,
                            label=node_data["label"],
                            properties=node_data.get("properties", {})
                        ))
            
            if "Bank" in query:
                # Return bank nodes
                for node_id, node_data in self.graph.nodes(data=True):
                    if node_data.get("type") == "Bank":
                        nodes.append(GraphNode(
                            id=node_id,
                            label=node_data["label"],
                            properties=node_data.get("properties", {})
                        ))
            
            if "RELATIONSHIP" in query.upper() or "->" in query:
                # Return edges
                for source, target, edge_data in self.graph.edges(data=True):
                    edges.append(GraphEdge(
                        source=source,
                        target=target,
                        relationship=edge_data.get("relationship", "UNKNOWN"),
                        properties={k: v for k, v in edge_data.items() if k != "relationship"}
                    ))
        
        return nodes, edges
    
    def find_shortest_path(self, source: str, target: str) -> List[str]:
        """Find shortest path between nodes"""
        try:
            path = nx.shortest_path(self.graph.to_undirected(), source, target)
            return path
        except nx.NetworkXNoPath:
            return []
    
    def get_neighbors(self, node_id: str, relationship_type: str = None) -> List[GraphNode]:
        """Get neighboring nodes"""
        neighbors = []
        
        if node_id in self.graph:
            for neighbor in self.graph.neighbors(node_id):
                edge_data = self.graph.get_edge_data(node_id, neighbor)
                
                # Check relationship type filter
                if relationship_type:
                    edge_matches = any(
                        edge_attrs.get("relationship") == relationship_type
                        for edge_attrs in edge_data.values()
                    )
                    if not edge_matches:
                        continue
                
                node_data = self.graph.nodes[neighbor]
                neighbors.append(GraphNode(
                    id=neighbor,
                    label=node_data["label"],
                    properties=node_data.get("properties", {})
                ))
        
        return neighbors
    
    def get_stats(self) -> GraphStats:
        """Get graph statistics"""
        node_types = {}
        edge_types = {}
        
        # Count node types
        for node_id, node_data in self.graph.nodes(data=True):
            node_type = node_data.get("type", "Unknown")
            node_types[node_type] = node_types.get(node_type, 0) + 1
        
        # Count edge types
        for source, target, edge_data in self.graph.edges(data=True):
            edge_type = edge_data.get("relationship", "Unknown")
            edge_types[edge_type] = edge_types.get(edge_type, 0) + 1
        
        return GraphStats(
            total_nodes=len(self.graph.nodes),
            total_edges=len(self.graph.edges),
            node_types=node_types,
            edge_types=edge_types,
            last_updated=datetime.utcnow()
        )

# Global graph database
falkor_db = FalkorGraphDB()

class QueryOptimizer:
    """Query optimizer with business rules integration"""
    
    def __init__(self):
        self.optimization_rules = {
            "limit_large_queries": True,
            "index_hint_injection": True,
            "relationship_pruning": True,
            "result_caching": True
        }
    
    def optimize_query(self, query: str, facts: Dict[str, Any]) -> str:
        """Optimize query based on business rules"""
        optimized_query = query
        
        # Apply optimization rules
        if facts.get("graph_nodes", 0) > 1000:
            # Add limit for large graphs
            if "LIMIT" not in optimized_query.upper():
                optimized_query += " LIMIT 100"
        
        if facts.get("query_complexity", 1) > 5:
            # Simplify complex queries
            optimized_query = self._simplify_query(optimized_query)
        
        return optimized_query
    
    def _simplify_query(self, query: str) -> str:
        """Simplify complex queries"""
        # Basic query simplification
        if "OPTIONAL" in query.upper():
            # Remove optional matches for performance
            query = query.replace("OPTIONAL MATCH", "MATCH")
        
        return query

class BusinessRulesClient:
    """Client for business rules service integration"""
    
    async def evaluate_rules(self, service: str, facts: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate business rules for FalkorDB operations"""
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
query_optimizer = QueryOptimizer()
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
    
    logger.info("Enhanced FalkorDB service started")

async def shutdown_event():
    """Cleanup on shutdown"""
    global redis_client
    
    if redis_client:
        await redis_client.close()
    
    logger.info("Enhanced FalkorDB service stopped")

app.add_event_handler("startup", startup_event)
app.add_event_handler("shutdown", shutdown_event)

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "graph_loaded": falkor_db.loaded,
        "timestamp": datetime.utcnow(),
        "services": {
            "redis": "connected" if redis_client else "disconnected",
            "falkor_db": "loaded" if falkor_db.loaded else "not_loaded",
            "business_rules": "available"
        }
    }

@app.post("/query", response_model=GraphQueryResult)
async def execute_query(query_request: GraphQuery):
    """Execute graph query with business rules optimization"""
    global query_count, last_query_time
    
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    start_time = time.time()
    
    try:
        # Prepare facts for business rules evaluation
        query_facts = {
            "query_type": query_request.query_type,
            "query_length": len(query_request.query),
            "graph_nodes": len(falkor_db.graph.nodes),
            "graph_edges": len(falkor_db.graph.edges),
            "result_limit": query_request.limit,
            "timeout": query_request.timeout,
            "has_parameters": query_request.parameters is not None,
            "query_complexity": query_request.query.count("MATCH") + query_request.query.count("WHERE") + query_request.query.count("OPTIONAL")
        }
        
        # Evaluate business rules
        rules_result = await rules_client.evaluate_rules("falkor_db", query_facts)
        
        # Apply business rules conclusions
        optimize_query = rules_result.get("conclusion", {}).get("optimize_query", False)
        
        # Optimize query if needed
        optimized_query = query_request.query
        if optimize_query:
            optimized_query = query_optimizer.optimize_query(query_request.query, query_facts)
        
        # Execute query based on type
        if query_request.query_type == "cypher":
            nodes, edges = falkor_db.execute_cypher_query(optimized_query, query_request.parameters)
        elif query_request.query_type == "pattern":
            # Pattern matching query
            nodes, edges = falkor_db.execute_cypher_query(f"MATCH {optimized_query}", query_request.parameters)
        elif query_request.query_type == "traversal":
            # Graph traversal query
            nodes = []
            edges = []
            # Simple traversal implementation
            if "neighbors" in optimized_query.lower():
                # Get neighbors of specified node
                node_id = query_request.parameters.get("node_id") if query_request.parameters else None
                if node_id:
                    nodes = falkor_db.get_neighbors(node_id)
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported query type: {query_request.query_type}")
        
        # Apply result limit
        nodes = nodes[:query_request.limit]
        edges = edges[:query_request.limit]
        
        # Calculate query time
        query_time = time.time() - start_time
        
        # Update global counters
        query_count += 1
        last_query_time = datetime.utcnow()
        
        # Cache result if Redis is available
        if redis_client:
            cache_key = f"falkor_query:{hash(query_request.query)}"
            cache_data = {
                "nodes": [node.dict() for node in nodes],
                "edges": [edge.dict() for edge in edges],
                "query_time": query_time,
                "timestamp": last_query_time.isoformat()
            }
            await redis_client.setex(cache_key, 300, json.dumps(cache_data))
        
        return GraphQueryResult(
            nodes=nodes,
            edges=edges,
            query_time=query_time,
            result_count=len(nodes) + len(edges),
            business_rules_applied=rules_result.get("reasoning_trace", []),
            optimized_query=optimized_query,
            timestamp=last_query_time
        )
        
    except Exception as e:
        logger.error(f"Query execution error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/stats", response_model=GraphStats)
async def get_graph_stats():
    """Get graph database statistics"""
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    return falkor_db.get_stats()

@app.get("/nodes/{node_id}")
async def get_node(node_id: str):
    """Get specific node by ID"""
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    if node_id not in falkor_db.graph:
        raise HTTPException(status_code=404, detail="Node not found")
    
    node_data = falkor_db.graph.nodes[node_id]
    return GraphNode(
        id=node_id,
        label=node_data["label"],
        properties=node_data.get("properties", {})
    )

@app.get("/nodes/{node_id}/neighbors")
async def get_node_neighbors(node_id: str, relationship_type: Optional[str] = None):
    """Get neighbors of a specific node"""
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    if node_id not in falkor_db.graph:
        raise HTTPException(status_code=404, detail="Node not found")
    
    neighbors = falkor_db.get_neighbors(node_id, relationship_type)
    
    return {
        "node_id": node_id,
        "neighbors": neighbors,
        "count": len(neighbors),
        "relationship_filter": relationship_type
    }

@app.post("/path")
async def find_shortest_path(source: str, target: str):
    """Find shortest path between two nodes"""
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    if source not in falkor_db.graph:
        raise HTTPException(status_code=404, detail="Source node not found")
    
    if target not in falkor_db.graph:
        raise HTTPException(status_code=404, detail="Target node not found")
    
    path = falkor_db.find_shortest_path(source, target)
    
    if not path:
        return {
            "source": source,
            "target": target,
            "path": [],
            "length": 0,
            "found": False
        }
    
    # Get node details for path
    path_nodes = []
    for node_id in path:
        node_data = falkor_db.graph.nodes[node_id]
        path_nodes.append({
            "id": node_id,
            "label": node_data["label"],
            "type": node_data.get("type", "Unknown")
        })
    
    return {
        "source": source,
        "target": target,
        "path": path_nodes,
        "length": len(path) - 1,
        "found": True
    }

@app.get("/metrics")
async def get_metrics():
    """Get service metrics"""
    return {
        "total_queries": query_count,
        "last_query": last_query_time,
        "graph_loaded": falkor_db.loaded,
        "nodes_count": len(falkor_db.graph.nodes) if falkor_db.loaded else 0,
        "edges_count": len(falkor_db.graph.edges) if falkor_db.loaded else 0,
        "version": "2.0.0"
    }

@app.post("/test")
async def test_service():
    """Test service with sample query"""
    if not falkor_db.loaded:
        raise HTTPException(status_code=503, detail="Graph database not loaded")
    
    # Create test query
    test_query = GraphQuery(
        query_type="cypher",
        query="MATCH (c:Customer)-[:CUSTOMER_OF]->(b:Bank) RETURN c, b",
        limit=10,
        timeout=30
    )
    
    # Execute test query
    result = await execute_query(test_query)
    
    return {
        "test_status": "success",
        "result": result
    }

if __name__ == "__main__":
    uvicorn.run(
        "enhanced_falkor_db:app",
        host="0.0.0.0",
        port=8090,
        reload=True,
        log_level="info"
    )

