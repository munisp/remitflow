#!/usr/bin/env python3
"""
EPR-KGQA - Enhanced Probabilistic Reasoning Knowledge Graph Question Answering
High-performance implementation for real-time knowledge graph reasoning
"""

import asyncio
import time
import json
import logging
from typing import Dict, List, Any, Optional, Tuple, Set
from dataclasses import dataclass, asdict
from collections import defaultdict, deque
import numpy as np
import networkx as nx
import redis.asyncio as aioredis

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@dataclass
class Entity:
    """Knowledge graph entity"""
    id: str
    name: str
    type: str
    properties: Dict[str, Any]
    embeddings: Optional[List[float]] = None

@dataclass
class Relation:
    """Knowledge graph relation"""
    id: str
    name: str
    source: str
    target: str
    properties: Dict[str, Any]
    weight: float = 1.0

@dataclass
class KGTriple:
    """Knowledge graph triple (subject, predicate, object)"""
    subject: str
    predicate: str
    object: str
    confidence: float = 1.0
    timestamp: float = 0.0

@dataclass
class Question:
    """Natural language question for KGQA"""
    id: str
    text: str
    entities: List[str]
    relations: List[str]
    expected_answer_type: str
    complexity: int = 1

@dataclass
class Answer:
    """Answer to a knowledge graph question"""
    question_id: str
    entities: List[str]
    confidence: float
    reasoning_path: List[str]
    execution_time_ms: float
    evidence: List[KGTriple]

class EPR_KGQA:
    """
    Enhanced Probabilistic Reasoning Knowledge Graph Question Answering
    Optimized for high-performance real-time reasoning
    """
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis_url = redis_url
        self.redis = None
        self.knowledge_graph = nx.MultiDiGraph()
        self.entity_index = {}
        self.relation_index = {}
        self.embedding_cache = {}
        self.reasoning_cache = {}
        self.stats = {
            'questions_processed': 0,
            'avg_reasoning_time': 0.0,
            'cache_hits': 0,
            'graph_size': {'entities': 0, 'relations': 0}
        }
        
        # Reasoning strategies
        self.reasoning_strategies = {
            'direct_lookup': self._direct_lookup,
            'single_hop': self._single_hop_reasoning,
            'multi_hop': self._multi_hop_reasoning,
            'probabilistic': self._probabilistic_reasoning,
            'path_ranking': self._path_ranking_reasoning
        }
        
        # Question patterns for entity/relation extraction
        self.question_patterns = {
            'what_is': r'what is (.*?)\?',
            'who_is': r'who is (.*?)\?',
            'where_is': r'where is (.*?)\?',
            'when_did': r'when did (.*?)\?',
            'how_many': r'how many (.*?)\?',
            'list_all': r'list all (.*?)(?:\s+that|\s+which|\s*$)',
            'relationship': r'what is the relationship between (.*?) and (.*?)\?'
        }
    
    async def initialize(self):
        """Initialize Redis connection and load knowledge graph"""
        self.redis = aioredis.from_url(self.redis_url, decode_responses=True)
        
        # Load existing knowledge graph
        await self._load_knowledge_graph()
        
        # Initialize reasoning cache
        await self._initialize_reasoning_cache()
        
        logger.info(f"EPR-KGQA initialized with {len(self.knowledge_graph.nodes)} entities and {len(self.knowledge_graph.edges)} relations")
    
    async def _load_knowledge_graph(self):
        """Load knowledge graph from Redis"""
        try:
            # Load entities
            entity_keys = await self.redis.keys("kg:entity:*")
            for key in entity_keys:
                entity_data = await self.redis.hgetall(key)
                if entity_data:
                    entity = Entity(
                        id=entity_data['id'],
                        name=entity_data['name'],
                        type=entity_data['type'],
                        properties=json.loads(entity_data.get('properties', '{}')),
                        embeddings=json.loads(entity_data.get('embeddings', 'null'))
                    )
                    self.entity_index[entity.id] = entity
                    self.knowledge_graph.add_node(entity.id, **asdict(entity))
            
            # Load relations
            relation_keys = await self.redis.keys("kg:relation:*")
            for key in relation_keys:
                relation_data = await self.redis.hgetall(key)
                if relation_data:
                    relation = Relation(
                        id=relation_data['id'],
                        name=relation_data['name'],
                        source=relation_data['source'],
                        target=relation_data['target'],
                        properties=json.loads(relation_data.get('properties', '{}')),
                        weight=float(relation_data.get('weight', 1.0))
                    )
                    self.relation_index[relation.id] = relation
                    self.knowledge_graph.add_edge(
                        relation.source, 
                        relation.target, 
                        key=relation.id,
                        **asdict(relation)
                    )
            
            # Update statistics
            self.stats['graph_size']['entities'] = len(self.entity_index)
            self.stats['graph_size']['relations'] = len(self.relation_index)
            
        except Exception as e:
            logger.error(f"Error loading knowledge graph: {e}")
    
    async def _initialize_reasoning_cache(self):
        """Initialize reasoning cache for frequent queries"""
        # Load cached reasoning results
        cache_keys = await self.redis.keys("kgqa:cache:*")
        for key in cache_keys:
            cached_data = await self.redis.get(key)
            if cached_data:
                question_hash = key.split(':')[-1]
                self.reasoning_cache[question_hash] = json.loads(cached_data)
    
    async def add_entity(self, entity: Entity) -> bool:
        """Add entity to knowledge graph"""
        try:
            # Store in Redis
            entity_data = asdict(entity)
            entity_data['properties'] = json.dumps(entity_data['properties'])
            entity_data['embeddings'] = json.dumps(entity_data['embeddings'])
            
            await self.redis.hset(f"kg:entity:{entity.id}", mapping=entity_data)
            
            # Add to in-memory structures
            self.entity_index[entity.id] = entity
            self.knowledge_graph.add_node(entity.id, **asdict(entity))
            
            # Update statistics
            self.stats['graph_size']['entities'] = len(self.entity_index)
            
            return True
        except Exception as e:
            logger.error(f"Error adding entity {entity.id}: {e}")
            return False
    
    async def add_relation(self, relation: Relation) -> bool:
        """Add relation to knowledge graph"""
        try:
            # Store in Redis
            relation_data = asdict(relation)
            relation_data['properties'] = json.dumps(relation_data['properties'])
            
            await self.redis.hset(f"kg:relation:{relation.id}", mapping=relation_data)
            
            # Add to in-memory structures
            self.relation_index[relation.id] = relation
            self.knowledge_graph.add_edge(
                relation.source,
                relation.target,
                key=relation.id,
                **asdict(relation)
            )
            
            # Update statistics
            self.stats['graph_size']['relations'] = len(self.relation_index)
            
            return True
        except Exception as e:
            logger.error(f"Error adding relation {relation.id}: {e}")
            return False
    
    async def add_triple(self, triple: KGTriple) -> bool:
        """Add knowledge graph triple"""
        # Create entities if they don't exist
        if triple.subject not in self.entity_index:
            entity = Entity(
                id=triple.subject,
                name=triple.subject,
                type="unknown",
                properties={}
            )
            await self.add_entity(entity)
        
        if triple.object not in self.entity_index:
            entity = Entity(
                id=triple.object,
                name=triple.object,
                type="unknown",
                properties={}
            )
            await self.add_entity(entity)
        
        # Create relation
        relation_id = f"{triple.subject}_{triple.predicate}_{triple.object}"
        relation = Relation(
            id=relation_id,
            name=triple.predicate,
            source=triple.subject,
            target=triple.object,
            properties={'confidence': triple.confidence, 'timestamp': triple.timestamp},
            weight=triple.confidence
        )
        
        return await self.add_relation(relation)
    
    async def bulk_add_triples(self, triples: List[KGTriple]) -> int:
        """Bulk add multiple triples for high performance"""
        start_time = time.time()
        
        # Use Redis pipeline for batch operations
        pipe = self.redis.pipeline()
        
        entities_to_add = {}
        relations_to_add = {}
        
        # Prepare entities and relations
        for triple in triples:
            # Prepare entities
            if triple.subject not in self.entity_index:
                entity = Entity(
                    id=triple.subject,
                    name=triple.subject,
                    type="unknown",
                    properties={}
                )
                entities_to_add[entity.id] = entity
            
            if triple.object not in self.entity_index:
                entity = Entity(
                    id=triple.object,
                    name=triple.object,
                    type="unknown",
                    properties={}
                )
                entities_to_add[entity.id] = entity
            
            # Prepare relation
            relation_id = f"{triple.subject}_{triple.predicate}_{triple.object}"
            relation = Relation(
                id=relation_id,
                name=triple.predicate,
                source=triple.subject,
                target=triple.object,
                properties={'confidence': triple.confidence, 'timestamp': triple.timestamp},
                weight=triple.confidence
            )
            relations_to_add[relation.id] = relation
        
        # Batch add entities
        for entity in entities_to_add.values():
            entity_data = asdict(entity)
            entity_data['properties'] = json.dumps(entity_data['properties'])
            entity_data['embeddings'] = json.dumps(entity_data['embeddings'])
            pipe.hset(f"kg:entity:{entity.id}", mapping=entity_data)
            
            # Add to in-memory structures
            self.entity_index[entity.id] = entity
            self.knowledge_graph.add_node(entity.id, **asdict(entity))
        
        # Batch add relations
        for relation in relations_to_add.values():
            relation_data = asdict(relation)
            relation_data['properties'] = json.dumps(relation_data['properties'])
            pipe.hset(f"kg:relation:{relation.id}", mapping=relation_data)
            
            # Add to in-memory structures
            self.relation_index[relation.id] = relation
            self.knowledge_graph.add_edge(
                relation.source,
                relation.target,
                key=relation.id,
                **asdict(relation)
            )
        
        # Execute pipeline
        await pipe.execute()
        
        # Update statistics
        self.stats['graph_size']['entities'] = len(self.entity_index)
        self.stats['graph_size']['relations'] = len(self.relation_index)
        
        execution_time = (time.time() - start_time) * 1000
        logger.info(f"Bulk added {len(triples)} triples in {execution_time:.2f}ms")
        
        return len(triples)
    
    async def answer_question(self, question: Question) -> Answer:
        """Answer a natural language question using knowledge graph reasoning"""
        start_time = time.time()
        
        # Check cache first
        question_hash = self._hash_question(question)
        if question_hash in self.reasoning_cache:
            cached_answer = Answer(**self.reasoning_cache[question_hash])
            cached_answer.execution_time_ms = (time.time() - start_time) * 1000
            self.stats['cache_hits'] += 1
            return cached_answer
        
        # Extract entities and relations from question
        extracted_entities, extracted_relations = await self._extract_entities_relations(question)
        
        # Determine reasoning strategy based on question complexity
        strategy = self._select_reasoning_strategy(question, extracted_entities, extracted_relations)
        
        # Execute reasoning
        answer_entities, confidence, reasoning_path, evidence = await strategy(
            question, extracted_entities, extracted_relations
        )
        
        # Create answer
        execution_time = (time.time() - start_time) * 1000
        answer = Answer(
            question_id=question.id,
            entities=answer_entities,
            confidence=confidence,
            reasoning_path=reasoning_path,
            execution_time_ms=execution_time,
            evidence=evidence
        )
        
        # Cache answer
        self.reasoning_cache[question_hash] = asdict(answer)
        await self.redis.setex(
            f"kgqa:cache:{question_hash}",
            3600,  # 1 hour cache
            json.dumps(asdict(answer), default=str)
        )
        
        # Update statistics
        self.stats['questions_processed'] += 1
        self._update_avg_reasoning_time(execution_time)
        
        return answer
    
    async def _extract_entities_relations(self, question: Question) -> Tuple[List[str], List[str]]:
        """Extract entities and relations from natural language question"""
        # Simple entity extraction based on knowledge graph
        entities = []
        relations = []
        
        question_text = question.text.lower()
        
        # Find entities by name matching
        for entity_id, entity in self.entity_index.items():
            if entity.name.lower() in question_text:
                entities.append(entity_id)
        
        # Find relations by name matching
        for relation_id, relation in self.relation_index.items():
            if relation.name.lower() in question_text:
                relations.append(relation_id)
        
        # Use provided entities and relations if available
        if question.entities:
            entities.extend(question.entities)
        if question.relations:
            relations.extend(question.relations)
        
        return list(set(entities)), list(set(relations))
    
    def _select_reasoning_strategy(self, question: Question, entities: List[str], relations: List[str]) -> callable:
        """Select appropriate reasoning strategy based on question characteristics"""
        if len(entities) == 1 and len(relations) == 0:
            return self.reasoning_strategies['direct_lookup']
        elif len(entities) >= 1 and len(relations) <= 1:
            return self.reasoning_strategies['single_hop']
        elif question.complexity <= 2:
            return self.reasoning_strategies['multi_hop']
        elif question.complexity <= 3:
            return self.reasoning_strategies['probabilistic']
        else:
            return self.reasoning_strategies['path_ranking']
    
    async def _direct_lookup(self, question: Question, entities: List[str], relations: List[str]) -> Tuple[List[str], float, List[str], List[KGTriple]]:
        """Direct entity lookup strategy"""
        if not entities:
            return [], 0.0, ["No entities found"], []
        
        entity_id = entities[0]
        if entity_id in self.entity_index:
            entity = self.entity_index[entity_id]
            return [entity_id], 1.0, [f"Direct lookup: {entity.name}"], []
        
        return [], 0.0, ["Entity not found"], []
    
    async def _single_hop_reasoning(self, question: Question, entities: List[str], relations: List[str]) -> Tuple[List[str], float, List[str], List[KGTriple]]:
        """Single-hop reasoning strategy"""
        if not entities:
            return [], 0.0, ["No entities found"], []
        
        results = []
        evidence = []
        reasoning_path = []
        
        for entity_id in entities:
            if entity_id in self.knowledge_graph:
                # Get all neighbors
                neighbors = list(self.knowledge_graph.neighbors(entity_id))
                
                # Filter by relation if specified
                if relations:
                    filtered_neighbors = []
                    for neighbor in neighbors:
                        edges = self.knowledge_graph.get_edge_data(entity_id, neighbor)
                        for edge_key, edge_data in edges.items():
                            if edge_data['name'] in [self.relation_index[r].name for r in relations]:
                                filtered_neighbors.append(neighbor)
                                # Create evidence triple
                                triple = KGTriple(
                                    subject=entity_id,
                                    predicate=edge_data['name'],
                                    object=neighbor,
                                    confidence=edge_data.get('weight', 1.0)
                                )
                                evidence.append(triple)
                    neighbors = filtered_neighbors
                
                results.extend(neighbors)
                reasoning_path.append(f"Single hop from {entity_id}: found {len(neighbors)} neighbors")
        
        confidence = 0.8 if results else 0.0
        return list(set(results)), confidence, reasoning_path, evidence
    
    async def _multi_hop_reasoning(self, question: Question, entities: List[str], relations: List[str]) -> Tuple[List[str], float, List[str], List[KGTriple]]:
        """Multi-hop reasoning strategy using BFS"""
        if not entities:
            return [], 0.0, ["No entities found"], []
        
        max_hops = min(question.complexity, 3)
        results = set()
        evidence = []
        reasoning_path = []
        
        for start_entity in entities:
            if start_entity not in self.knowledge_graph:
                continue
            
            # BFS for multi-hop reasoning
            queue = deque([(start_entity, 0, [])])  # (entity, hop_count, path)
            visited = set()
            
            while queue:
                current_entity, hop_count, path = queue.popleft()
                
                if current_entity in visited or hop_count > max_hops:
                    continue
                
                visited.add(current_entity)
                
                if hop_count > 0:  # Don't include start entity
                    results.add(current_entity)
                
                # Add neighbors to queue
                for neighbor in self.knowledge_graph.neighbors(current_entity):
                    if neighbor not in visited:
                        new_path = path + [f"{current_entity} -> {neighbor}"]
                        queue.append((neighbor, hop_count + 1, new_path))
                        
                        # Create evidence triple
                        edges = self.knowledge_graph.get_edge_data(current_entity, neighbor)
                        for edge_key, edge_data in edges.items():
                            triple = KGTriple(
                                subject=current_entity,
                                predicate=edge_data['name'],
                                object=neighbor,
                                confidence=edge_data.get('weight', 1.0)
                            )
                            evidence.append(triple)
            
            reasoning_path.append(f"Multi-hop reasoning from {start_entity}: {max_hops} hops, {len(results)} results")
        
        confidence = 0.6 if results else 0.0
        return list(results), confidence, reasoning_path, evidence
    
    async def _probabilistic_reasoning(self, question: Question, entities: List[str], relations: List[str]) -> Tuple[List[str], float, List[str], List[KGTriple]]:
        """Probabilistic reasoning using path weights"""
        if not entities:
            return [], 0.0, ["No entities found"], []
        
        # Use shortest path with weights for probabilistic reasoning
        results = {}  # entity -> probability
        evidence = []
        reasoning_path = []
        
        for start_entity in entities:
            if start_entity not in self.knowledge_graph:
                continue
            
            # Calculate shortest paths to all reachable entities
            try:
                paths = nx.single_source_shortest_path_length(
                    self.knowledge_graph, 
                    start_entity, 
                    cutoff=3
                )
                
                for target_entity, path_length in paths.items():
                    if target_entity != start_entity:
                        # Calculate probability based on path length and edge weights
                        try:
                            path = nx.shortest_path(self.knowledge_graph, start_entity, target_entity)
                            path_weight = 1.0
                            
                            for i in range(len(path) - 1):
                                edges = self.knowledge_graph.get_edge_data(path[i], path[i + 1])
                                if edges:
                                    max_weight = max(edge_data.get('weight', 1.0) for edge_data in edges.values())
                                    path_weight *= max_weight
                            
                            # Probability decreases with path length
                            probability = path_weight / (path_length + 1)
                            results[target_entity] = max(results.get(target_entity, 0), probability)
                            
                        except nx.NetworkXNoPath:
                            continue
                
                reasoning_path.append(f"Probabilistic reasoning from {start_entity}: {len(results)} weighted results")
                
            except Exception as e:
                logger.error(f"Error in probabilistic reasoning: {e}")
                continue
        
        # Sort by probability and return top results
        sorted_results = sorted(results.items(), key=lambda x: x[1], reverse=True)
        top_entities = [entity for entity, prob in sorted_results[:10]]
        avg_confidence = sum(prob for _, prob in sorted_results[:10]) / len(sorted_results[:10]) if sorted_results else 0.0
        
        return top_entities, avg_confidence, reasoning_path, evidence
    
    async def _path_ranking_reasoning(self, question: Question, entities: List[str], relations: List[str]) -> Tuple[List[str], float, List[str], List[KGTriple]]:
        """Advanced path ranking reasoning for complex questions"""
        if not entities:
            return [], 0.0, ["No entities found"], []
        
        # Find all paths between entities and rank them
        path_scores = {}
        evidence = []
        reasoning_path = []
        
        if len(entities) >= 2:
            # Find paths between entity pairs
            for i, entity1 in enumerate(entities):
                for j, entity2 in enumerate(entities[i + 1:], i + 1):
                    if entity1 in self.knowledge_graph and entity2 in self.knowledge_graph:
                        try:
                            # Find all simple paths (up to length 4)
                            paths = list(nx.all_simple_paths(
                                self.knowledge_graph, 
                                entity1, 
                                entity2, 
                                cutoff=4
                            ))
                            
                            for path in paths:
                                # Score path based on length and edge weights
                                path_score = 1.0
                                for k in range(len(path) - 1):
                                    edges = self.knowledge_graph.get_edge_data(path[k], path[k + 1])
                                    if edges:
                                        max_weight = max(edge_data.get('weight', 1.0) for edge_data in edges.values())
                                        path_score *= max_weight
                                
                                # Penalize longer paths
                                path_score /= len(path)
                                
                                # Add intermediate entities to results
                                for entity in path[1:-1]:  # Exclude start and end
                                    path_scores[entity] = max(path_scores.get(entity, 0), path_score)
                            
                            reasoning_path.append(f"Path ranking between {entity1} and {entity2}: {len(paths)} paths")
                            
                        except nx.NetworkXNoPath:
                            continue
        else:
            # Single entity - find highly connected entities
            for entity in entities:
                if entity in self.knowledge_graph:
                    neighbors = list(self.knowledge_graph.neighbors(entity))
                    for neighbor in neighbors:
                        # Score based on connection strength
                        edges = self.knowledge_graph.get_edge_data(entity, neighbor)
                        max_weight = max(edge_data.get('weight', 1.0) for edge_data in edges.values())
                        path_scores[neighbor] = max(path_scores.get(neighbor, 0), max_weight)
        
        # Sort by score and return top results
        sorted_results = sorted(path_scores.items(), key=lambda x: x[1], reverse=True)
        top_entities = [entity for entity, score in sorted_results[:10]]
        avg_confidence = sum(score for _, score in sorted_results[:10]) / len(sorted_results[:10]) if sorted_results else 0.0
        
        return top_entities, avg_confidence, reasoning_path, evidence
    
    def _hash_question(self, question: Question) -> str:
        """Generate hash for question caching"""
        import hashlib
        question_str = f"{question.text}:{','.join(question.entities)}:{','.join(question.relations)}"
        return hashlib.md5(question_str.encode()).hexdigest()
    
    def _update_avg_reasoning_time(self, execution_time: float):
        """Update average reasoning time statistics"""
        if self.stats['questions_processed'] == 1:
            self.stats['avg_reasoning_time'] = execution_time
        else:
            # Exponential moving average
            alpha = 0.1
            self.stats['avg_reasoning_time'] = (
                alpha * execution_time + 
                (1 - alpha) * self.stats['avg_reasoning_time']
            )
    
    async def get_entity_neighbors(self, entity_id: str, max_hops: int = 1) -> Dict[str, Any]:
        """Get neighbors of an entity up to max_hops"""
        if entity_id not in self.knowledge_graph:
            return {'neighbors': [], 'total_count': 0}
        
        neighbors = set()
        current_level = {entity_id}
        
        for hop in range(max_hops):
            next_level = set()
            for node in current_level:
                node_neighbors = set(self.knowledge_graph.neighbors(node))
                next_level.update(node_neighbors)
                neighbors.update(node_neighbors)
            current_level = next_level - neighbors  # Avoid revisiting
        
        neighbor_data = []
        for neighbor in neighbors:
            if neighbor in self.entity_index:
                neighbor_data.append({
                    'id': neighbor,
                    'name': self.entity_index[neighbor].name,
                    'type': self.entity_index[neighbor].type
                })
        
        return {
            'neighbors': neighbor_data,
            'total_count': len(neighbor_data)
        }
    
    async def find_shortest_path(self, source: str, target: str) -> Optional[List[str]]:
        """Find shortest path between two entities"""
        try:
            if source in self.knowledge_graph and target in self.knowledge_graph:
                path = nx.shortest_path(self.knowledge_graph, source, target)
                return path
        except nx.NetworkXNoPath:
            pass
        return None
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get EPR-KGQA performance statistics"""
        return {
            'epr_kgqa_stats': self.stats,
            'graph_stats': {
                'entities': len(self.entity_index),
                'relations': len(self.relation_index),
                'avg_degree': sum(dict(self.knowledge_graph.degree()).values()) / max(len(self.knowledge_graph.nodes), 1),
                'connected_components': nx.number_weakly_connected_components(self.knowledge_graph)
            },
            'cache_stats': {
                'reasoning_cache_size': len(self.reasoning_cache),
                'cache_hit_ratio': self.stats['cache_hits'] / max(self.stats['questions_processed'], 1)
            }
        }
    
    async def close(self):
        """Close Redis connection"""
        if self.redis:
            await self.redis.close()
        logger.info("EPR-KGQA connections closed")

# High-performance question answering service
class EPR_KGQA_Service:
    """
    High-performance EPR-KGQA service for handling multiple concurrent questions
    """
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.kgqa = EPR_KGQA(redis_url)
        self.question_queue = asyncio.Queue(maxsize=10000)
        self.workers = []
        self.num_workers = 10
        self.stats = {
            'total_questions': 0,
            'questions_per_second': 0.0,
            'avg_queue_size': 0.0
        }
    
    async def initialize(self):
        """Initialize service and start workers"""
        await self.kgqa.initialize()
        
        # Start worker tasks
        for i in range(self.num_workers):
            worker = asyncio.create_task(self._worker(f"worker-{i}"))
            self.workers.append(worker)
        
        logger.info(f"EPR-KGQA service initialized with {self.num_workers} workers")
    
    async def _worker(self, worker_id: str):
        """Worker task for processing questions"""
        while True:
            try:
                question, result_future = await self.question_queue.get()
                
                # Process question
                answer = await self.kgqa.answer_question(question)
                
                # Set result
                result_future.set_result(answer)
                
                # Mark task as done
                self.question_queue.task_done()
                
                # Update statistics
                self.stats['total_questions'] += 1
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")
    
    async def ask_question(self, question: Question) -> Answer:
        """Submit question for processing"""
        result_future = asyncio.Future()
        
        # Add to queue
        await self.question_queue.put((question, result_future))
        
        # Wait for result
        return await result_future
    
    async def bulk_ask_questions(self, questions: List[Question]) -> List[Answer]:
        """Process multiple questions concurrently"""
        tasks = [self.ask_question(q) for q in questions]
        return await asyncio.gather(*tasks)
    
    async def get_service_stats(self) -> Dict[str, Any]:
        """Get service performance statistics"""
        kgqa_stats = await self.kgqa.get_stats()
        
        return {
            'service_stats': self.stats,
            'queue_size': self.question_queue.qsize(),
            'active_workers': len(self.workers),
            'kgqa_stats': kgqa_stats
        }
    
    async def close(self):
        """Close service and cleanup workers"""
        # Cancel workers
        for worker in self.workers:
            worker.cancel()
        
        # Wait for workers to finish
        await asyncio.gather(*self.workers, return_exceptions=True)
        
        # Close KGQA
        await self.kgqa.close()

if __name__ == "__main__":
    async def demo():
        # Initialize EPR-KGQA
        kgqa = EPR_KGQA()
        await kgqa.initialize()
        
        # Add sample knowledge graph data
        triples = [
            KGTriple("alice", "works_at", "company_a", 0.9),
            KGTriple("bob", "works_at", "company_a", 0.8),
            KGTriple("company_a", "located_in", "new_york", 1.0),
            KGTriple("alice", "knows", "bob", 0.7),
            KGTriple("charlie", "works_at", "company_b", 0.9),
            KGTriple("company_b", "located_in", "san_francisco", 1.0),
        ]
        
        await kgqa.bulk_add_triples(triples)
        
        # Ask questions
        questions = [
            Question("q1", "Who works at company_a?", ["company_a"], ["works_at"], "person"),
            Question("q2", "Where is company_a located?", ["company_a"], ["located_in"], "location"),
            Question("q3", "Who does Alice know?", ["alice"], ["knows"], "person", complexity=2),
        ]
        
        for question in questions:
            answer = await kgqa.answer_question(question)
            print(f"Q: {question.text}")
            print(f"A: {answer.entities} (confidence: {answer.confidence:.2f}, time: {answer.execution_time_ms:.2f}ms)")
            print(f"Reasoning: {answer.reasoning_path}")
            print()
        
        # Get statistics
        stats = await kgqa.get_stats()
        print(f"Questions processed: {stats['epr_kgqa_stats']['questions_processed']}")
        print(f"Average reasoning time: {stats['epr_kgqa_stats']['avg_reasoning_time']:.2f}ms")
        print(f"Graph size: {stats['graph_stats']['entities']} entities, {stats['graph_stats']['relations']} relations")
        
        await kgqa.close()
    
    asyncio.run(demo())

