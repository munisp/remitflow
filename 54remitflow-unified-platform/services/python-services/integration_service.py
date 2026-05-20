#!/usr/bin/env python3
"""
Integration Service - Bi-directional integration between CocoIndex and EPR-KGQA
High-performance service for real-time data synchronization and query optimization
"""

import asyncio
import time
import json
import logging
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import numpy as np
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Import our custom components
from coco_index import CocoIndex, CocoIndexCluster, IndexEntry
from epr_kgqa import EPR_KGQA, EPR_KGQA_Service, Question, Answer, KGTriple, Entity, Relation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class IntegrationStats:
    """Statistics for the integration service"""
    total_operations: int = 0
    sync_operations: int = 0
    query_operations: int = 0
    avg_response_time: float = 0.0
    cache_hits: int = 0
    errors: int = 0

class CocoKGQAIntegration:
    """
    Bi-directional integration between CocoIndex and EPR-KGQA
    Provides real-time synchronization and optimized querying
    """
    
    def __init__(self, redis_urls: List[str] = None):
        if redis_urls is None:
            redis_urls = ["redis://localhost:6379"]
        
        # Initialize components
        if len(redis_urls) > 1:
            self.coco_index = CocoIndexCluster(redis_urls)
        else:
            self.coco_index = CocoIndex(redis_urls[0])
        
        self.kgqa_service = EPR_KGQA_Service(redis_urls[0])
        self.kgqa = self.kgqa_service.kgqa
        
        # Integration state
        self.sync_mappings = {}  # Maps CocoIndex keys to KG entities
        self.reverse_mappings = {}  # Maps KG entities to CocoIndex keys
        self.stats = IntegrationStats()
        
        # Sync configuration
        self.auto_sync = True
        self.sync_batch_size = 1000
        self.sync_interval = 5.0  # seconds
        
        # Background tasks
        self.sync_task = None
        self.optimization_task = None
    
    async def initialize(self):
        """Initialize all components and start background tasks"""
        # Initialize components
        await self.coco_index.initialize()
        await self.kgqa_service.initialize()
        
        # Load existing mappings
        await self._load_sync_mappings()
        
        # Start background tasks
        if self.auto_sync:
            self.sync_task = asyncio.create_task(self._sync_worker())
            self.optimization_task = asyncio.create_task(self._optimization_worker())
        
        logger.info("CocoKGQA Integration initialized")
    
    async def _load_sync_mappings(self):
        """Load existing synchronization mappings"""
        try:
            # Load from Redis if available
            if hasattr(self.coco_index, 'redis'):
                redis = self.coco_index.redis
            else:
                redis = self.coco_index.indexes[0].redis
            
            mappings_data = await redis.get("integration:sync_mappings")
            if mappings_data:
                self.sync_mappings = json.loads(mappings_data)
                # Build reverse mappings
                self.reverse_mappings = {v: k for k, v in self.sync_mappings.items()}
                
            logger.info(f"Loaded {len(self.sync_mappings)} sync mappings")
        except Exception as e:
            logger.error(f"Error loading sync mappings: {e}")
    
    async def _save_sync_mappings(self):
        """Save synchronization mappings to Redis"""
        try:
            if hasattr(self.coco_index, 'redis'):
                redis = self.coco_index.redis
            else:
                redis = self.coco_index.indexes[0].redis
            
            await redis.set(
                "integration:sync_mappings",
                json.dumps(self.sync_mappings)
            )
        except Exception as e:
            logger.error(f"Error saving sync mappings: {e}")
    
    async def add_indexed_entity(self, key: str, entity_data: Dict[str, Any], 
                               metadata: Dict[str, Any] = None) -> bool:
        """Add entity to both CocoIndex and Knowledge Graph"""
        start_time = time.time()
        
        try:
            # Add to CocoIndex
            await self.coco_index.insert(key, entity_data, metadata)
            
            # Create KG entity
            entity_id = f"entity_{key}"
            entity = Entity(
                id=entity_id,
                name=entity_data.get('name', key),
                type=entity_data.get('type', 'unknown'),
                properties=entity_data
            )
            
            await self.kgqa.add_entity(entity)
            
            # Update mappings
            self.sync_mappings[key] = entity_id
            self.reverse_mappings[entity_id] = key
            
            # Create relationships if metadata contains references
            if metadata:
                await self._create_relationships_from_metadata(entity_id, metadata)
            
            # Update statistics
            self.stats.total_operations += 1
            self.stats.sync_operations += 1
            execution_time = (time.time() - start_time) * 1000
            self._update_avg_response_time(execution_time)
            
            return True
            
        except Exception as e:
            logger.error(f"Error adding indexed entity {key}: {e}")
            self.stats.errors += 1
            return False
    
    async def _create_relationships_from_metadata(self, entity_id: str, metadata: Dict[str, Any]):
        """Create KG relationships based on metadata"""
        for key, value in metadata.items():
            if key.endswith('_ref') and isinstance(value, str):
                # Reference to another entity
                target_entity_id = self.sync_mappings.get(value)
                if target_entity_id:
                    relation_name = key.replace('_ref', '')
                    relation = Relation(
                        id=f"{entity_id}_{relation_name}_{target_entity_id}",
                        name=relation_name,
                        source=entity_id,
                        target=target_entity_id,
                        properties={'auto_generated': True},
                        weight=0.8
                    )
                    await self.kgqa.add_relation(relation)
            
            elif key.endswith('_refs') and isinstance(value, list):
                # Multiple references
                relation_name = key.replace('_refs', '')
                for ref_value in value:
                    target_entity_id = self.sync_mappings.get(ref_value)
                    if target_entity_id:
                        relation = Relation(
                            id=f"{entity_id}_{relation_name}_{target_entity_id}",
                            name=relation_name,
                            source=entity_id,
                            target=target_entity_id,
                            properties={'auto_generated': True},
                            weight=0.7
                        )
                        await self.kgqa.add_relation(relation)
    
    async def query_integrated(self, query: str, query_type: str = "auto", 
                             limit: int = 100) -> Dict[str, Any]:
        """Perform integrated query across both CocoIndex and Knowledge Graph"""
        start_time = time.time()
        
        try:
            results = {
                'coco_results': [],
                'kg_results': [],
                'integrated_results': [],
                'execution_time_ms': 0,
                'query_type': query_type
            }
            
            if query_type in ["auto", "index"]:
                # Query CocoIndex
                coco_results = await self._query_coco_index(query, limit)
                results['coco_results'] = coco_results
            
            if query_type in ["auto", "knowledge"]:
                # Query Knowledge Graph
                kg_results = await self._query_knowledge_graph(query, limit)
                results['kg_results'] = kg_results
            
            if query_type == "auto":
                # Integrate results
                integrated = await self._integrate_query_results(
                    results['coco_results'], 
                    results['kg_results']
                )
                results['integrated_results'] = integrated
            
            # Update statistics
            self.stats.total_operations += 1
            self.stats.query_operations += 1
            execution_time = (time.time() - start_time) * 1000
            results['execution_time_ms'] = execution_time
            self._update_avg_response_time(execution_time)
            
            return results
            
        except Exception as e:
            logger.error(f"Error in integrated query: {e}")
            self.stats.errors += 1
            raise HTTPException(status_code=500, detail=str(e))
    
    async def _query_coco_index(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Query CocoIndex with text-based search"""
        # Simple text matching for demo - in production, use proper text search
        results = []
        
        # Try to extract key-value filters from query
        filters = self._parse_query_filters(query)
        
        if hasattr(self.coco_index, 'query'):
            # Single index
            query_result = await self.coco_index.query(filters, limit=limit)
            for entry in query_result.entries:
                results.append({
                    'key': entry.key,
                    'value': entry.value,
                    'metadata': entry.metadata,
                    'timestamp': entry.timestamp,
                    'source': 'coco_index'
                })
        else:
            # Cluster - query first index for demo
            query_result = await self.coco_index.indexes[0].query(filters, limit=limit)
            for entry in query_result.entries:
                results.append({
                    'key': entry.key,
                    'value': entry.value,
                    'metadata': entry.metadata,
                    'timestamp': entry.timestamp,
                    'source': 'coco_index'
                })
        
        return results
    
    async def _query_knowledge_graph(self, query: str, limit: int) -> List[Dict[str, Any]]:
        """Query Knowledge Graph with natural language"""
        # Create question from query
        question = Question(
            id=f"q_{int(time.time())}",
            text=query,
            entities=[],
            relations=[],
            expected_answer_type="entity"
        )
        
        # Get answer
        answer = await self.kgqa.answer_question(question)
        
        # Format results
        results = []
        for entity_id in answer.entities[:limit]:
            if entity_id in self.kgqa.entity_index:
                entity = self.kgqa.entity_index[entity_id]
                results.append({
                    'entity_id': entity.id,
                    'name': entity.name,
                    'type': entity.type,
                    'properties': entity.properties,
                    'confidence': answer.confidence,
                    'source': 'knowledge_graph'
                })
        
        return results
    
    async def _integrate_query_results(self, coco_results: List[Dict], 
                                     kg_results: List[Dict]) -> List[Dict[str, Any]]:
        """Integrate results from both CocoIndex and Knowledge Graph"""
        integrated = []
        
        # Create lookup for KG results by entity ID
        kg_lookup = {result['entity_id']: result for result in kg_results}
        
        # Integrate CocoIndex results with KG data
        for coco_result in coco_results:
            key = coco_result['key']
            entity_id = self.sync_mappings.get(key)
            
            integrated_result = {
                'key': key,
                'coco_data': coco_result,
                'kg_data': None,
                'integration_score': 0.5
            }
            
            if entity_id and entity_id in kg_lookup:
                integrated_result['kg_data'] = kg_lookup[entity_id]
                integrated_result['integration_score'] = 0.9
                # Remove from KG lookup to avoid duplicates
                del kg_lookup[entity_id]
            
            integrated.append(integrated_result)
        
        # Add remaining KG results that don't have CocoIndex counterparts
        for entity_id, kg_result in kg_lookup.items():
            key = self.reverse_mappings.get(entity_id)
            integrated_result = {
                'key': key,
                'coco_data': None,
                'kg_data': kg_result,
                'integration_score': 0.7
            }
            integrated.append(integrated_result)
        
        # Sort by integration score
        integrated.sort(key=lambda x: x['integration_score'], reverse=True)
        
        return integrated
    
    def _parse_query_filters(self, query: str) -> Dict[str, Any]:
        """Parse natural language query into CocoIndex filters"""
        filters = {}
        
        # Simple keyword extraction for demo
        query_lower = query.lower()
        
        # Look for common patterns
        if 'type:' in query_lower:
            type_match = query_lower.split('type:')[1].split()[0]
            filters['type'] = type_match
        
        if 'name:' in query_lower:
            name_match = query_lower.split('name:')[1].split()[0]
            filters['name'] = name_match
        
        return filters
    
    async def sync_data(self, direction: str = "bidirectional") -> Dict[str, Any]:
        """Manually trigger data synchronization"""
        start_time = time.time()
        
        sync_stats = {
            'coco_to_kg': 0,
            'kg_to_coco': 0,
            'errors': 0,
            'execution_time_ms': 0
        }
        
        try:
            if direction in ["bidirectional", "coco_to_kg"]:
                # Sync CocoIndex data to Knowledge Graph
                coco_synced = await self._sync_coco_to_kg()
                sync_stats['coco_to_kg'] = coco_synced
            
            if direction in ["bidirectional", "kg_to_coco"]:
                # Sync Knowledge Graph data to CocoIndex
                kg_synced = await self._sync_kg_to_coco()
                sync_stats['kg_to_coco'] = kg_synced
            
            # Save updated mappings
            await self._save_sync_mappings()
            
            execution_time = (time.time() - start_time) * 1000
            sync_stats['execution_time_ms'] = execution_time
            
            logger.info(f"Data sync completed: {sync_stats}")
            
            return sync_stats
            
        except Exception as e:
            logger.error(f"Error in data sync: {e}")
            sync_stats['errors'] += 1
            return sync_stats
    
    async def _sync_coco_to_kg(self) -> int:
        """Sync CocoIndex entries to Knowledge Graph"""
        synced_count = 0
        
        try:
            # Get all CocoIndex entries (simplified for demo)
            if hasattr(self.coco_index, 'redis'):
                redis = self.coco_index.redis
            else:
                redis = self.coco_index.indexes[0].redis
            
            entry_keys = await redis.keys("coco:entry:*")
            
            for key in entry_keys:
                entry_data = await redis.hgetall(key)
                if entry_data:
                    entry_dict = {k.decode(): json.loads(v.decode()) for k, v in entry_data.items()}
                    coco_key = entry_dict['key']
                    
                    # Check if already synced
                    if coco_key not in self.sync_mappings:
                        # Create KG entity
                        entity_id = f"entity_{coco_key}"
                        entity = Entity(
                            id=entity_id,
                            name=entry_dict.get('value', {}).get('name', coco_key),
                            type=entry_dict.get('metadata', {}).get('type', 'unknown'),
                            properties=entry_dict.get('value', {})
                        )
                        
                        if await self.kgqa.add_entity(entity):
                            self.sync_mappings[coco_key] = entity_id
                            self.reverse_mappings[entity_id] = coco_key
                            synced_count += 1
            
        except Exception as e:
            logger.error(f"Error syncing CocoIndex to KG: {e}")
        
        return synced_count
    
    async def _sync_kg_to_coco(self) -> int:
        """Sync Knowledge Graph entities to CocoIndex"""
        synced_count = 0
        
        try:
            for entity_id, entity in self.kgqa.entity_index.items():
                # Check if already synced
                if entity_id not in self.reverse_mappings:
                    # Create CocoIndex entry
                    coco_key = f"kg_{entity.id}"
                    
                    entry_data = {
                        'name': entity.name,
                        'type': entity.type,
                        'properties': entity.properties
                    }
                    
                    metadata = {
                        'source': 'knowledge_graph',
                        'entity_id': entity.id,
                        'type': entity.type
                    }
                    
                    if await self.coco_index.insert(coco_key, entry_data, metadata):
                        self.sync_mappings[coco_key] = entity_id
                        self.reverse_mappings[entity_id] = coco_key
                        synced_count += 1
        
        except Exception as e:
            logger.error(f"Error syncing KG to CocoIndex: {e}")
        
        return synced_count
    
    async def _sync_worker(self):
        """Background worker for automatic synchronization"""
        while True:
            try:
                await asyncio.sleep(self.sync_interval)
                
                # Perform incremental sync
                sync_stats = await self.sync_data()
                
                if sync_stats['coco_to_kg'] > 0 or sync_stats['kg_to_coco'] > 0:
                    logger.info(f"Auto-sync completed: {sync_stats}")
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in sync worker: {e}")
    
    async def _optimization_worker(self):
        """Background worker for performance optimization"""
        while True:
            try:
                await asyncio.sleep(60)  # Run every minute
                
                # Optimize CocoIndex
                if hasattr(self.coco_index, 'optimize'):
                    await self.coco_index.optimize()
                elif hasattr(self.coco_index, 'indexes'):
                    for index in self.coco_index.indexes:
                        await index.optimize()
                
                # Clean up old cache entries
                await self._cleanup_cache()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in optimization worker: {e}")
    
    async def _cleanup_cache(self):
        """Clean up old cache entries"""
        try:
            if hasattr(self.coco_index, 'redis'):
                redis = self.coco_index.redis
            else:
                redis = self.coco_index.indexes[0].redis
            
            # Clean up expired query cache
            cache_keys = await redis.keys("integration:cache:*")
            for key in cache_keys:
                ttl = await redis.ttl(key)
                if ttl == -1:  # No expiration set
                    await redis.expire(key, 3600)  # Set 1 hour expiration
        
        except Exception as e:
            logger.error(f"Error cleaning up cache: {e}")
    
    def _update_avg_response_time(self, execution_time: float):
        """Update average response time statistics"""
        if self.stats.total_operations == 1:
            self.stats.avg_response_time = execution_time
        else:
            # Exponential moving average
            alpha = 0.1
            self.stats.avg_response_time = (
                alpha * execution_time + 
                (1 - alpha) * self.stats.avg_response_time
            )
    
    async def get_integration_stats(self) -> Dict[str, Any]:
        """Get comprehensive integration statistics"""
        coco_stats = await self.coco_index.get_stats() if hasattr(self.coco_index, 'get_stats') else {}
        kgqa_stats = await self.kgqa_service.get_service_stats()
        
        return {
            'integration_stats': asdict(self.stats),
            'sync_mappings_count': len(self.sync_mappings),
            'coco_stats': coco_stats,
            'kgqa_stats': kgqa_stats,
            'performance_metrics': {
                'operations_per_second': self.stats.total_operations / max(time.time() - start_time, 1) if 'start_time' in globals() else 0,
                'error_rate': self.stats.errors / max(self.stats.total_operations, 1),
                'cache_hit_rate': self.stats.cache_hits / max(self.stats.total_operations, 1)
            }
        }
    
    async def close(self):
        """Close all connections and stop background tasks"""
        # Stop background tasks
        if self.sync_task:
            self.sync_task.cancel()
        if self.optimization_task:
            self.optimization_task.cancel()
        
        # Wait for tasks to finish
        if self.sync_task or self.optimization_task:
            await asyncio.gather(
                self.sync_task, self.optimization_task, 
                return_exceptions=True
            )
        
        # Close components
        await self.coco_index.close()
        await self.kgqa_service.close()
        
        logger.info("CocoKGQA Integration closed")

# FastAPI application for the integration service
app = FastAPI(title="CocoKGQA Integration Service", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global integration instance
integration = None

@app.on_event("startup")
async def startup_event():
    global integration
    integration = CocoKGQAIntegration()
    await integration.initialize()
    logger.info("Integration service started")

@app.on_event("shutdown")
async def shutdown_event():
    global integration
    if integration:
        await integration.close()
    logger.info("Integration service stopped")

@app.post("/api/v1/entities")
async def add_entity(entity_data: Dict[str, Any]):
    """Add entity to both CocoIndex and Knowledge Graph"""
    key = entity_data.get('key')
    if not key:
        raise HTTPException(status_code=400, detail="Key is required")
    
    data = entity_data.get('data', {})
    metadata = entity_data.get('metadata', {})
    
    success = await integration.add_indexed_entity(key, data, metadata)
    
    if success:
        return {"status": "success", "key": key}
    else:
        raise HTTPException(status_code=500, detail="Failed to add entity")

@app.get("/api/v1/query")
async def query_integrated(q: str, query_type: str = "auto", limit: int = 100):
    """Perform integrated query across both systems"""
    results = await integration.query_integrated(q, query_type, limit)
    return results

@app.post("/api/v1/sync")
async def sync_data(direction: str = "bidirectional"):
    """Manually trigger data synchronization"""
    sync_stats = await integration.sync_data(direction)
    return sync_stats

@app.get("/api/v1/stats")
async def get_stats():
    """Get comprehensive integration statistics"""
    stats = await integration.get_integration_stats()
    return stats

@app.get("/api/v1/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "timestamp": time.time(),
        "service": "CocoKGQA Integration"
    }

# High-performance bulk operations
@app.post("/api/v1/bulk/entities")
async def bulk_add_entities(entities: List[Dict[str, Any]]):
    """Bulk add entities for high performance"""
    start_time = time.time()
    
    success_count = 0
    error_count = 0
    
    # Process in batches for optimal performance
    batch_size = 100
    for i in range(0, len(entities), batch_size):
        batch = entities[i:i + batch_size]
        
        # Process batch concurrently
        tasks = []
        for entity_data in batch:
            key = entity_data.get('key')
            data = entity_data.get('data', {})
            metadata = entity_data.get('metadata', {})
            
            if key:
                task = integration.add_indexed_entity(key, data, metadata)
                tasks.append(task)
        
        # Wait for batch completion
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, Exception):
                error_count += 1
            elif result:
                success_count += 1
            else:
                error_count += 1
    
    execution_time = (time.time() - start_time) * 1000
    
    return {
        "total_processed": len(entities),
        "success_count": success_count,
        "error_count": error_count,
        "execution_time_ms": execution_time,
        "throughput_ops_per_sec": len(entities) / (execution_time / 1000)
    }

@app.post("/api/v1/bulk/queries")
async def bulk_query(queries: List[Dict[str, Any]]):
    """Bulk query processing for high performance"""
    start_time = time.time()
    
    # Process queries concurrently
    tasks = []
    for query_data in queries:
        query = query_data.get('query', '')
        query_type = query_data.get('type', 'auto')
        limit = query_data.get('limit', 100)
        
        task = integration.query_integrated(query, query_type, limit)
        tasks.append(task)
    
    # Wait for all queries to complete
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    execution_time = (time.time() - start_time) * 1000
    
    # Format results
    formatted_results = []
    error_count = 0
    
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            formatted_results.append({
                "query_id": i,
                "error": str(result),
                "success": False
            })
            error_count += 1
        else:
            formatted_results.append({
                "query_id": i,
                "result": result,
                "success": True
            })
    
    return {
        "total_queries": len(queries),
        "success_count": len(queries) - error_count,
        "error_count": error_count,
        "execution_time_ms": execution_time,
        "throughput_queries_per_sec": len(queries) / (execution_time / 1000),
        "results": formatted_results
    }

if __name__ == "__main__":
    # Run the integration service
    uvicorn.run(
        "integration_service:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        workers=1
    )

