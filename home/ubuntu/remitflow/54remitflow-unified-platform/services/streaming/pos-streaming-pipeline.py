#!/usr/bin/env python3
"""
POS Real-time Streaming and Data Pipeline Service
Provides real-time data streaming, processing, and integration with lakehouse
"""

import os
import json
import logging
import asyncio
import aiohttp
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple, Callable
import warnings
warnings.filterwarnings('ignore')

# Streaming and messaging
from kafka import KafkaProducer, KafkaConsumer
from kafka.errors import KafkaError
import redis.asyncio as redis

# Database connections
import asyncpg
from pymongo import MongoClient

# Flask for API endpoints
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# WebSocket for real-time updates
import websockets
import socket

# Data processing
from concurrent.futures import ThreadPoolExecutor
import threading
import queue
import time

# Monitoring
from prometheus_client import Counter, Histogram, Gauge, start_http_server

# ML and analytics
from sklearn.preprocessing import StandardScaler
import joblib

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
streaming_messages_total = Counter('streaming_messages_total', 'Total streaming messages processed', ['topic', 'status'])
streaming_processing_time = Histogram('streaming_processing_time_seconds', 'Message processing time', ['topic'])
streaming_queue_size = Gauge('streaming_queue_size', 'Current queue size', ['queue_type'])
streaming_connections = Gauge('streaming_connections', 'Active WebSocket connections')
streaming_throughput = Gauge('streaming_throughput_per_second', 'Messages per second', ['topic'])

class POSStreamingPipeline:
    """Real-time Streaming and Data Pipeline Service"""
    
    def __init__(self):
        self.setup_configuration()
        self.setup_flask_app()
        self.setup_connections()
        self.setup_queues()
        self.setup_processors()
        self.running = True
        
        # WebSocket connections
        self.websocket_connections = set()
        
        # Processing statistics
        self.stats = {
            'messages_processed': 0,
            'errors_count': 0,
            'start_time': datetime.now(),
            'last_message_time': None
        }
        
    def setup_configuration(self):
        """Setup configuration parameters"""
        self.config = {
            # Kafka configuration
            'kafka_bootstrap_servers': os.getenv('KAFKA_BOOTSTRAP_SERVERS', os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'localhost:9092')),
            'kafka_topics': {
                'pos_transactions': 'pos-transactions',
                'pos_devices': 'pos-devices',
                'pos_analytics': 'pos-analytics',
                'fraud_alerts': 'fraud-alerts',
                'device_health': 'device-health',
                'system_events': 'system-events'
            },
            
            # Fluvio configuration
            'fluvio_url': os.getenv('FLUVIO_URL', os.getenv('SERVICE_URL_9003', 'http://localhost:9003')),
            'fluvio_topics': {
                'pos_stream': 'pos-stream',
                'analytics_stream': 'analytics-stream',
                'alerts_stream': 'alerts-stream'
            },
            
            # Database connections
            'postgres_url': os.getenv('POSTGRES_URL', os.getenv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/remittance')),
            'redis_url': os.getenv('REDIS_URL', os.getenv('REDIS_URL', 'redis://localhost:6379')),
            'mongo_url': os.getenv('MONGO_URL', os.getenv('MONGO_URL', 'mongodb://localhost:27017/')),
            
            # Lakehouse integration
            'lakehouse_url': os.getenv('LAKEHOUSE_URL', os.getenv('SERVICE_URL_8097', os.getenv('LAKEHOUSE_URL', 'http://localhost:8097'))),
            
            # Processing configuration
            'batch_size': int(os.getenv('BATCH_SIZE', '1000')),
            'processing_interval': float(os.getenv('PROCESSING_INTERVAL', '1.0')),
            'max_queue_size': int(os.getenv('MAX_QUEUE_SIZE', '10000')),
            'worker_threads': int(os.getenv('WORKER_THREADS', '8')),
            
            # WebSocket configuration
            'websocket_port': int(os.getenv('WEBSOCKET_PORT', '8098')),
            'max_websocket_connections': int(os.getenv('MAX_WEBSOCKET_CONNECTIONS', '1000')),
            
            # Alert thresholds
            'alert_thresholds': {
                'fraud_score': 0.8,
                'device_health': 0.3,
                'transaction_anomaly': 0.9,
                'queue_size': 5000,
                'processing_delay': 10.0
            }
        }
        
    def setup_flask_app(self):
        """Setup Flask application with SocketIO"""
        self.app = Flask(__name__)
        CORS(self.app)
        self.socketio = SocketIO(self.app, cors_allowed_origins="*")
        self.setup_routes()
        
    def setup_connections(self):
        """Setup external connections"""
        try:
            # Kafka producer
            self.kafka_producer = KafkaProducer(
                bootstrap_servers=self.config['kafka_bootstrap_servers'],
                value_serializer=lambda v: json.dumps(v).encode('utf-8'),
                key_serializer=lambda k: str(k).encode('utf-8') if k else None,
                acks='all',
                retries=3,
                batch_size=16384,
                linger_ms=10,
                buffer_memory=33554432
            )
            
            # Kafka consumers (will be created per topic)
            self.kafka_consumers = {}
            
            # Redis client (async)
            self.redis_client = None  # Will be initialized in async context
            
            # MongoDB client
            self.mongo_client = MongoClient(self.config['mongo_url'])
            self.streaming_db = self.mongo_client.pos_streaming
            
            logger.info("External connections configured")
            
        except Exception as e:
            logger.error(f"Failed to setup connections: {e}")
            raise
    
    def setup_queues(self):
        """Setup processing queues"""
        self.queues = {
            'transactions': queue.Queue(maxsize=self.config['max_queue_size']),
            'devices': queue.Queue(maxsize=self.config['max_queue_size']),
            'analytics': queue.Queue(maxsize=self.config['max_queue_size']),
            'alerts': queue.Queue(maxsize=self.config['max_queue_size']),
            'websocket_broadcast': queue.Queue(maxsize=1000)
        }
        
    def setup_processors(self):
        """Setup message processors"""
        self.processors = {
            'pos_transactions': self.process_transaction_message,
            'pos_devices': self.process_device_message,
            'pos_analytics': self.process_analytics_message,
            'fraud_alerts': self.process_alert_message,
            'device_health': self.process_health_message,
            'system_events': self.process_system_event
        }
        
        # Thread pool for processing
        self.executor = ThreadPoolExecutor(max_workers=self.config['worker_threads'])
        
    def setup_routes(self):
        """Setup Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'version': '2.0.0',
                'stats': self.get_processing_stats()
            })
        
        @self.app.route('/api/v1/stream/send', methods=['POST'])
        def send_message():
            try:
                data = request.get_json()
                topic = data.get('topic')
                message = data.get('message')
                
                if not topic or not message:
                    return jsonify({'error': 'topic and message required'}), 400
                
                # Send to Kafka
                self.send_kafka_message(topic, message)
                
                return jsonify({'status': 'sent', 'topic': topic})
                
            except Exception as e:
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/stream/stats', methods=['GET'])
        def get_stats():
            return jsonify(self.get_processing_stats())
        
        @self.app.route('/api/v1/stream/topics', methods=['GET'])
        def get_topics():
            return jsonify({
                'kafka_topics': list(self.config['kafka_topics'].values()),
                'fluvio_topics': list(self.config['fluvio_topics'].values())
            })
        
        @self.app.route('/api/v1/stream/queues', methods=['GET'])
        def get_queue_status():
            return jsonify({
                queue_name: queue_obj.qsize() 
                for queue_name, queue_obj in self.queues.items()
            })
        
        # SocketIO events
        @self.socketio.on('connect')
        def handle_connect():
            self.websocket_connections.add(request.sid)
            streaming_connections.set(len(self.websocket_connections))
            emit('connected', {'status': 'connected', 'timestamp': datetime.now().isoformat()})
            logger.info(f"WebSocket client connected: {request.sid}")
        
        @self.socketio.on('disconnect')
        def handle_disconnect():
            self.websocket_connections.discard(request.sid)
            streaming_connections.set(len(self.websocket_connections))
            logger.info(f"WebSocket client disconnected: {request.sid}")
        
        @self.socketio.on('subscribe')
        def handle_subscribe(data):
            topics = data.get('topics', [])
            # Store subscription preferences (simplified)
            emit('subscribed', {'topics': topics, 'timestamp': datetime.now().isoformat()})
    
    async def initialize_async_components(self):
        """Initialize async components"""
        try:
            # Initialize Redis client
            self.redis_client = redis.from_url(self.config['redis_url'])
            
            # Initialize PostgreSQL connection pool
            self.db_pool = await asyncpg.create_pool(
                self.config['postgres_url'],
                min_size=5,
                max_size=20
            )
            
            logger.info("Async components initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize async components: {e}")
            raise
    
    # Kafka Integration
    def send_kafka_message(self, topic: str, message: Dict[str, Any], key: str = None):
        """Send message to Kafka topic"""
        try:
            # Add metadata
            enriched_message = {
                **message,
                'timestamp': datetime.now().isoformat(),
                'source': 'pos-streaming-pipeline',
                'message_id': f"{topic}_{int(time.time() * 1000)}"
            }
            
            # Send to Kafka
            future = self.kafka_producer.send(topic, value=enriched_message, key=key)
            future.add_callback(lambda metadata: self.on_kafka_success(topic, metadata))
            future.add_errback(lambda error: self.on_kafka_error(topic, error))
            
            # Update metrics
            streaming_messages_total.labels(topic=topic, status='sent').inc()
            
        except Exception as e:
            logger.error(f"Failed to send Kafka message to {topic}: {e}")
            streaming_messages_total.labels(topic=topic, status='error').inc()
    
    def on_kafka_success(self, topic: str, metadata):
        """Kafka send success callback"""
        logger.debug(f"Message sent to {topic} successfully: {metadata}")
    
    def on_kafka_error(self, topic: str, error):
        """Kafka send error callback"""
        logger.error(f"Failed to send message to {topic}: {error}")
        streaming_messages_total.labels(topic=topic, status='error').inc()
    
    def start_kafka_consumers(self):
        """Start Kafka consumers for all topics"""
        for topic_name, topic in self.config['kafka_topics'].items():
            consumer_thread = threading.Thread(
                target=self.run_kafka_consumer,
                args=(topic, topic_name),
                daemon=True
            )
            consumer_thread.start()
            logger.info(f"Started Kafka consumer for topic: {topic}")
    
    def run_kafka_consumer(self, topic: str, topic_name: str):
        """Run Kafka consumer for a specific topic"""
        try:
            consumer = KafkaConsumer(
                topic,
                bootstrap_servers=self.config['kafka_bootstrap_servers'],
                value_deserializer=lambda m: json.loads(m.decode('utf-8')),
                group_id=f'pos-streaming-{topic_name}',
                auto_offset_reset='latest',
                enable_auto_commit=True,
                consumer_timeout_ms=1000
            )
            
            self.kafka_consumers[topic_name] = consumer
            
            for message in consumer:
                if not self.running:
                    break
                
                try:
                    with streaming_processing_time.labels(topic=topic).time():
                        # Process message
                        processor = self.processors.get(topic_name)
                        if processor:
                            self.executor.submit(processor, message.value)
                        
                        # Update stats
                        self.stats['messages_processed'] += 1
                        self.stats['last_message_time'] = datetime.now()
                        
                        # Update metrics
                        streaming_messages_total.labels(topic=topic, status='processed').inc()
                        
                except Exception as e:
                    logger.error(f"Failed to process message from {topic}: {e}")
                    streaming_messages_total.labels(topic=topic, status='error').inc()
                    self.stats['errors_count'] += 1
            
        except Exception as e:
            logger.error(f"Kafka consumer error for {topic}: {e}")
    
    # Fluvio Integration
    async def send_fluvio_message(self, topic: str, message: Dict[str, Any]):
        """Send message to Fluvio topic"""
        try:
            async with aiohttp.ClientSession() as session:
                fluvio_message = {
                    'topic': topic,
                    'data': message,
                    'timestamp': datetime.now().isoformat(),
                    'source': 'pos-streaming-pipeline'
                }
                
                async with session.post(
                    f"{self.config['fluvio_url']}/topics/{topic}",
                    json=fluvio_message
                ) as response:
                    if response.status in [200, 201]:
                        logger.debug(f"Message sent to Fluvio topic {topic}")
                        streaming_messages_total.labels(topic=f"fluvio_{topic}", status='sent').inc()
                    else:
                        logger.error(f"Failed to send to Fluvio topic {topic}: {response.status}")
                        streaming_messages_total.labels(topic=f"fluvio_{topic}", status='error').inc()
                        
        except Exception as e:
            logger.error(f"Fluvio send error for {topic}: {e}")
            streaming_messages_total.labels(topic=f"fluvio_{topic}", status='error').inc()
    
    # Message Processors
    def process_transaction_message(self, message: Dict[str, Any]):
        """Process transaction message"""
        try:
            # Enrich transaction data
            enriched_transaction = self.enrich_transaction_data(message)
            
            # Add to processing queue
            if not self.queues['transactions'].full():
                self.queues['transactions'].put(enriched_transaction)
                streaming_queue_size.labels(queue_type='transactions').set(self.queues['transactions'].qsize())
            
            # Real-time fraud detection
            fraud_score = self.calculate_fraud_score(enriched_transaction)
            if fraud_score > self.config['alert_thresholds']['fraud_score']:
                self.trigger_fraud_alert(enriched_transaction, fraud_score)
            
            # Send to lakehouse
            asyncio.create_task(self.send_to_lakehouse('transaction', enriched_transaction))
            
            # Broadcast to WebSocket clients
            self.broadcast_to_websockets('transaction', enriched_transaction)
            
        except Exception as e:
            logger.error(f"Transaction processing error: {e}")
    
    def process_device_message(self, message: Dict[str, Any]):
        """Process device message"""
        try:
            # Enrich device data
            enriched_device = self.enrich_device_data(message)
            
            # Add to processing queue
            if not self.queues['devices'].full():
                self.queues['devices'].put(enriched_device)
                streaming_queue_size.labels(queue_type='devices').set(self.queues['devices'].qsize())
            
            # Health monitoring
            health_score = self.calculate_device_health(enriched_device)
            if health_score < self.config['alert_thresholds']['device_health']:
                self.trigger_health_alert(enriched_device, health_score)
            
            # Send to lakehouse
            asyncio.create_task(self.send_to_lakehouse('device', enriched_device))
            
            # Broadcast to WebSocket clients
            self.broadcast_to_websockets('device', enriched_device)
            
        except Exception as e:
            logger.error(f"Device processing error: {e}")
    
    def process_analytics_message(self, message: Dict[str, Any]):
        """Process analytics message"""
        try:
            # Add to processing queue
            if not self.queues['analytics'].full():
                self.queues['analytics'].put(message)
                streaming_queue_size.labels(queue_type='analytics').set(self.queues['analytics'].qsize())
            
            # Send to Fluvio analytics stream
            asyncio.create_task(self.send_fluvio_message('analytics_stream', message))
            
            # Broadcast to WebSocket clients
            self.broadcast_to_websockets('analytics', message)
            
        except Exception as e:
            logger.error(f"Analytics processing error: {e}")
    
    def process_alert_message(self, message: Dict[str, Any]):
        """Process alert message"""
        try:
            # Add to processing queue
            if not self.queues['alerts'].full():
                self.queues['alerts'].put(message)
                streaming_queue_size.labels(queue_type='alerts').set(self.queues['alerts'].qsize())
            
            # Store in MongoDB
            self.streaming_db.alerts.insert_one({
                **message,
                'processed_at': datetime.now()
            })
            
            # Send to Fluvio alerts stream
            asyncio.create_task(self.send_fluvio_message('alerts_stream', message))
            
            # Broadcast to WebSocket clients (high priority)
            self.broadcast_to_websockets('alert', message, priority=True)
            
        except Exception as e:
            logger.error(f"Alert processing error: {e}")
    
    def process_health_message(self, message: Dict[str, Any]):
        """Process device health message"""
        try:
            # Calculate health metrics
            health_metrics = self.calculate_health_metrics(message)
            
            # Store in Redis for quick access
            device_id = message.get('device_id')
            if device_id:
                asyncio.create_task(self.store_health_metrics(device_id, health_metrics))
            
            # Broadcast to WebSocket clients
            self.broadcast_to_websockets('health', health_metrics)
            
        except Exception as e:
            logger.error(f"Health processing error: {e}")
    
    def process_system_event(self, message: Dict[str, Any]):
        """Process system event message"""
        try:
            # Log system event
            logger.info(f"System event: {message}")
            
            # Store in MongoDB
            self.streaming_db.system_events.insert_one({
                **message,
                'processed_at': datetime.now()
            })
            
            # Broadcast to WebSocket clients
            self.broadcast_to_websockets('system_event', message)
            
        except Exception as e:
            logger.error(f"System event processing error: {e}")
    
    # Data Enrichment
    def enrich_transaction_data(self, transaction: Dict[str, Any]) -> Dict[str, Any]:
        """Enrich transaction data with additional context"""
        enriched = transaction.copy()
        
        # Add timestamp if not present
        if 'timestamp' not in enriched:
            enriched['timestamp'] = datetime.now().isoformat()
        
        # Add processing metadata
        enriched['processing_metadata'] = {
            'enriched_at': datetime.now().isoformat(),
            'pipeline_version': '2.0.0',
            'enrichment_source': 'pos-streaming-pipeline'
        }
        
        # Add derived fields
        amount = enriched.get('amount', 0)
        enriched['amount_category'] = self.categorize_amount(amount)
        enriched['risk_level'] = self.assess_transaction_risk(enriched)
        
        return enriched
    
    def enrich_device_data(self, device: Dict[str, Any]) -> Dict[str, Any]:
        """Enrich device data with additional context"""
        enriched = device.copy()
        
        # Add timestamp if not present
        if 'timestamp' not in enriched:
            enriched['timestamp'] = datetime.now().isoformat()
        
        # Add processing metadata
        enriched['processing_metadata'] = {
            'enriched_at': datetime.now().isoformat(),
            'pipeline_version': '2.0.0',
            'enrichment_source': 'pos-streaming-pipeline'
        }
        
        # Add derived fields
        enriched['status_category'] = self.categorize_device_status(enriched)
        enriched['maintenance_priority'] = self.assess_maintenance_priority(enriched)
        
        return enriched
    
    # Risk Assessment
    def calculate_fraud_score(self, transaction: Dict[str, Any]) -> float:
        """Calculate fraud score for transaction"""
        try:
            score = 0.0
            
            # Amount-based risk
            amount = transaction.get('amount', 0)
            if amount > 100000:  # High amount transactions
                score += 0.3
            elif amount > 50000:
                score += 0.1
            
            # Time-based risk
            hour = datetime.now().hour
            if hour < 6 or hour > 22:  # Off-hours transactions
                score += 0.2
            
            # Device-based risk
            device_id = transaction.get('pos_device_id')
            if device_id:
                # Check device health (simplified)
                score += 0.1 if self.is_device_suspicious(device_id) else 0.0
            
            # Customer-based risk
            customer_id = transaction.get('customer_id')
            if customer_id:
                score += 0.1 if self.is_customer_suspicious(customer_id) else 0.0
            
            return min(1.0, score)
            
        except Exception as e:
            logger.error(f"Fraud score calculation error: {e}")
            return 0.0
    
    def calculate_device_health(self, device: Dict[str, Any]) -> float:
        """Calculate device health score"""
        try:
            health_factors = []
            
            # Performance metrics
            perf_metrics = device.get('performance_metrics', {})
            if isinstance(perf_metrics, str):
                try:
                    perf_metrics = json.loads(perf_metrics)
                except:
                    perf_metrics = {}
            
            # CPU health
            cpu_usage = perf_metrics.get('cpu_usage', 0)
            cpu_health = max(0, 1 - cpu_usage / 100)
            health_factors.append(cpu_health * 0.3)
            
            # Memory health
            memory_usage = perf_metrics.get('memory_usage', 0)
            memory_health = max(0, 1 - memory_usage / 100)
            health_factors.append(memory_health * 0.3)
            
            # Error rate health
            error_rate = perf_metrics.get('error_rate', 0)
            error_health = max(0, 1 - error_rate)
            health_factors.append(error_health * 0.4)
            
            return sum(health_factors) if health_factors else 0.5
            
        except Exception as e:
            logger.error(f"Device health calculation error: {e}")
            return 0.5
    
    def calculate_health_metrics(self, health_data: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate comprehensive health metrics"""
        try:
            metrics = {
                'device_id': health_data.get('device_id'),
                'timestamp': datetime.now().isoformat(),
                'overall_health': self.calculate_device_health(health_data),
                'cpu_status': self.assess_cpu_status(health_data),
                'memory_status': self.assess_memory_status(health_data),
                'network_status': self.assess_network_status(health_data),
                'recommendations': self.generate_health_recommendations(health_data)
            }
            
            return metrics
            
        except Exception as e:
            logger.error(f"Health metrics calculation error: {e}")
            return {}
    
    # Helper Methods
    def categorize_amount(self, amount: float) -> str:
        """Categorize transaction amount"""
        if amount < 1000:
            return 'small'
        elif amount < 10000:
            return 'medium'
        elif amount < 100000:
            return 'large'
        else:
            return 'very_large'
    
    def assess_transaction_risk(self, transaction: Dict[str, Any]) -> str:
        """Assess transaction risk level"""
        fraud_score = self.calculate_fraud_score(transaction)
        
        if fraud_score > 0.8:
            return 'high'
        elif fraud_score > 0.5:
            return 'medium'
        else:
            return 'low'
    
    def categorize_device_status(self, device: Dict[str, Any]) -> str:
        """Categorize device status"""
        status = device.get('status', 'unknown')
        health_score = self.calculate_device_health(device)
        
        if status == 'offline':
            return 'offline'
        elif health_score < 0.3:
            return 'critical'
        elif health_score < 0.6:
            return 'warning'
        else:
            return 'healthy'
    
    def assess_maintenance_priority(self, device: Dict[str, Any]) -> str:
        """Assess device maintenance priority"""
        health_score = self.calculate_device_health(device)
        
        if health_score < 0.3:
            return 'urgent'
        elif health_score < 0.6:
            return 'medium'
        else:
            return 'low'
    
    def is_device_suspicious(self, device_id: str) -> bool:
        """Check if device is suspicious (simplified)"""
        # In a real implementation, this would check historical data
        return False
    
    def is_customer_suspicious(self, customer_id: str) -> bool:
        """Check if customer is suspicious (simplified)"""
        # In a real implementation, this would check historical data
        return False
    
    def assess_cpu_status(self, health_data: Dict[str, Any]) -> str:
        """Assess CPU status"""
        perf_metrics = health_data.get('performance_metrics', {})
        cpu_usage = perf_metrics.get('cpu_usage', 0)
        
        if cpu_usage > 90:
            return 'critical'
        elif cpu_usage > 70:
            return 'warning'
        else:
            return 'normal'
    
    def assess_memory_status(self, health_data: Dict[str, Any]) -> str:
        """Assess memory status"""
        perf_metrics = health_data.get('performance_metrics', {})
        memory_usage = perf_metrics.get('memory_usage', 0)
        
        if memory_usage > 90:
            return 'critical'
        elif memory_usage > 80:
            return 'warning'
        else:
            return 'normal'
    
    def assess_network_status(self, health_data: Dict[str, Any]) -> str:
        """Assess network status"""
        network_info = health_data.get('network_info', {})
        signal_strength = network_info.get('signal_strength', 100)
        
        if signal_strength < 30:
            return 'poor'
        elif signal_strength < 60:
            return 'fair'
        else:
            return 'good'
    
    def generate_health_recommendations(self, health_data: Dict[str, Any]) -> List[str]:
        """Generate health recommendations"""
        recommendations = []
        
        perf_metrics = health_data.get('performance_metrics', {})
        
        if perf_metrics.get('cpu_usage', 0) > 80:
            recommendations.append('Consider reducing CPU load or upgrading hardware')
        
        if perf_metrics.get('memory_usage', 0) > 80:
            recommendations.append('Memory usage is high, consider clearing cache or adding RAM')
        
        if perf_metrics.get('error_rate', 0) > 0.1:
            recommendations.append('High error rate detected, investigate system logs')
        
        return recommendations
    
    # Alert System
    def trigger_fraud_alert(self, transaction: Dict[str, Any], fraud_score: float):
        """Trigger fraud alert"""
        alert = {
            'type': 'fraud_detection',
            'severity': 'high',
            'transaction_id': transaction.get('transaction_id'),
            'device_id': transaction.get('pos_device_id'),
            'fraud_score': fraud_score,
            'timestamp': datetime.now().isoformat(),
            'details': transaction
        }
        
        # Send to alerts queue
        self.send_kafka_message('fraud_alerts', alert)
        
        logger.warning(f"Fraud alert triggered: {fraud_score} for transaction {transaction.get('transaction_id')}")
    
    def trigger_health_alert(self, device: Dict[str, Any], health_score: float):
        """Trigger device health alert"""
        alert = {
            'type': 'device_health',
            'severity': 'medium',
            'device_id': device.get('id'),
            'health_score': health_score,
            'timestamp': datetime.now().isoformat(),
            'details': device
        }
        
        # Send to alerts queue
        self.send_kafka_message('fraud_alerts', alert)
        
        logger.warning(f"Health alert triggered: {health_score} for device {device.get('id')}")
    
    # Lakehouse Integration
    async def send_to_lakehouse(self, data_type: str, data: Dict[str, Any]):
        """Send data to lakehouse for processing"""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    'data_type': data_type,
                    'data': data,
                    'timestamp': datetime.now().isoformat()
                }
                
                async with session.post(
                    f"{self.config['lakehouse_url']}/api/v1/ingest",
                    json=payload
                ) as response:
                    if response.status == 200:
                        logger.debug(f"Data sent to lakehouse: {data_type}")
                    else:
                        logger.error(f"Failed to send to lakehouse: {response.status}")
                        
        except Exception as e:
            logger.error(f"Lakehouse integration error: {e}")
    
    async def store_health_metrics(self, device_id: str, metrics: Dict[str, Any]):
        """Store health metrics in Redis"""
        try:
            if self.redis_client:
                await self.redis_client.setex(
                    f"device_health:{device_id}",
                    3600,  # 1 hour TTL
                    json.dumps(metrics)
                )
        except Exception as e:
            logger.error(f"Failed to store health metrics: {e}")
    
    # WebSocket Broadcasting
    def broadcast_to_websockets(self, event_type: str, data: Dict[str, Any], priority: bool = False):
        """Broadcast data to WebSocket clients"""
        try:
            message = {
                'type': event_type,
                'data': data,
                'timestamp': datetime.now().isoformat()
            }
            
            if priority:
                # Send immediately for high priority messages
                self.socketio.emit('realtime_update', message)
            else:
                # Add to broadcast queue for regular messages
                if not self.queues['websocket_broadcast'].full():
                    self.queues['websocket_broadcast'].put(message)
                    
        except Exception as e:
            logger.error(f"WebSocket broadcast error: {e}")
    
    def process_websocket_queue(self):
        """Process WebSocket broadcast queue"""
        while self.running:
            try:
                if not self.queues['websocket_broadcast'].empty():
                    message = self.queues['websocket_broadcast'].get(timeout=1)
                    self.socketio.emit('realtime_update', message)
                else:
                    time.sleep(0.1)
            except queue.Empty:
                continue
            except Exception as e:
                logger.error(f"WebSocket queue processing error: {e}")
    
    # Statistics and Monitoring
    def get_processing_stats(self) -> Dict[str, Any]:
        """Get processing statistics"""
        uptime = datetime.now() - self.stats['start_time']
        
        return {
            'messages_processed': self.stats['messages_processed'],
            'errors_count': self.stats['errors_count'],
            'uptime_seconds': uptime.total_seconds(),
            'last_message_time': self.stats['last_message_time'].isoformat() if self.stats['last_message_time'] else None,
            'queue_sizes': {
                name: queue_obj.qsize() 
                for name, queue_obj in self.queues.items()
            },
            'websocket_connections': len(self.websocket_connections),
            'throughput_per_second': self.stats['messages_processed'] / max(1, uptime.total_seconds())
        }
    
    def update_throughput_metrics(self):
        """Update throughput metrics"""
        while self.running:
            try:
                stats = self.get_processing_stats()
                
                # Update Prometheus metrics
                for queue_name, size in stats['queue_sizes'].items():
                    streaming_queue_size.labels(queue_type=queue_name).set(size)
                
                streaming_connections.set(stats['websocket_connections'])
                
                # Calculate per-topic throughput (simplified)
                for topic in self.config['kafka_topics'].values():
                    streaming_throughput.labels(topic=topic).set(stats['throughput_per_second'])
                
                time.sleep(10)  # Update every 10 seconds
                
            except Exception as e:
                logger.error(f"Metrics update error: {e}")
                time.sleep(10)
    
    # Main Service Methods
    def start_background_tasks(self):
        """Start background processing tasks"""
        # Start Kafka consumers
        self.start_kafka_consumers()
        
        # Start WebSocket queue processor
        websocket_thread = threading.Thread(target=self.process_websocket_queue, daemon=True)
        websocket_thread.start()
        
        # Start metrics updater
        metrics_thread = threading.Thread(target=self.update_throughput_metrics, daemon=True)
        metrics_thread.start()
        
        logger.info("Background tasks started")
    
    def run(self):
        """Run the streaming pipeline service"""
        try:
            logger.info("🚀 POS Streaming Pipeline v2.0 starting")
            logger.info(f"📊 Kafka servers: {self.config['kafka_bootstrap_servers']}")
            logger.info(f"🌊 Fluvio URL: {self.config['fluvio_url']}")
            logger.info(f"🔌 WebSocket port: {self.config['websocket_port']}")
            logger.info(f"👥 Max connections: {self.config['max_websocket_connections']}")
            
            # Initialize async components
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(self.initialize_async_components())
            
            # Start background tasks
            self.start_background_tasks()
            
            # Start Prometheus metrics server
            start_http_server(8099)
            logger.info("📈 Metrics server: http://0.0.0.0:8099/metrics")
            
            # Start Flask-SocketIO server
            logger.info("🌐 Starting Flask-SocketIO server")
            self.socketio.run(
                self.app,
                host=os.getenv('HOST', os.getenv('HOST', '0.0.0.0')),
                port=self.config['websocket_port'],
                debug=False,
                allow_unsafe_werkzeug=True
            )
            
        except KeyboardInterrupt:
            logger.info("Shutting down streaming pipeline")
            self.running = False
        except Exception as e:
            logger.error(f"Failed to start streaming pipeline: {e}")
            raise

def main():
    """Main entry point"""
    pipeline = POSStreamingPipeline()
    pipeline.run()

if __name__ == '__main__':
    main()

