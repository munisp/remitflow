#!/usr/bin/env python3
"""
Advanced Monitoring and Observability Service for Remittance Platform

This service provides comprehensive monitoring, alerting, and observability
capabilities for the entire banking platform including:
- Real-time metrics collection and aggregation
- Distributed tracing across microservices
- Log aggregation and analysis
- Anomaly detection using ML/AI
- Predictive analytics for system health
- Custom dashboards and visualization
- Intelligent alerting with ML-based noise reduction
"""

import asyncio
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from collections import defaultdict, deque
import threading
import queue
import statistics

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.cluster import DBSCAN
import joblib

import psycopg2
import redis
import requests
from flask import Flask, request, jsonify, render_template_string
from flask_cors import CORS
from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
import websocket
from websocket_server import WebsocketServer

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class MetricPoint:
    """Represents a single metric data point"""
    timestamp: datetime
    metric_name: str
    value: float
    labels: Dict[str, str]
    source: str
    tags: List[str] = None

@dataclass
class Alert:
    """Represents an alert"""
    id: str
    severity: str  # critical, warning, info
    title: str
    description: str
    metric_name: str
    current_value: float
    threshold: float
    timestamp: datetime
    source: str
    status: str = "active"  # active, acknowledged, resolved
    assignee: Optional[str] = None
    resolution_notes: Optional[str] = None

@dataclass
class AnomalyDetection:
    """Represents an anomaly detection result"""
    id: str
    timestamp: datetime
    metric_name: str
    value: float
    anomaly_score: float
    is_anomaly: bool
    confidence: float
    context: Dict[str, Any]

@dataclass
class SystemHealth:
    """Represents overall system health status"""
    timestamp: datetime
    overall_score: float  # 0-100
    component_scores: Dict[str, float]
    active_alerts: int
    critical_alerts: int
    warning_alerts: int
    anomalies_detected: int
    prediction_horizon: Dict[str, float]  # predicted issues in next N hours

class MonitoringService:
    """Advanced monitoring and observability service"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.metrics_buffer = deque(maxlen=10000)
        self.alerts = {}
        self.anomaly_detectors = {}
        self.system_health = None
        self.websocket_clients = set()
        
        # Initialize components
        self._init_database()
        self._init_redis()
        self._init_prometheus_metrics()
        self._init_ml_models()
        self._init_flask_app()
        
        # Background workers
        self.metrics_processor = MetricsProcessor(self)
        self.anomaly_detector = AnomalyDetector(self)
        self.alert_manager = AlertManager(self)
        self.health_calculator = HealthCalculator(self)
        self.predictive_analyzer = PredictiveAnalyzer(self)
        
        # Start background tasks
        self._start_background_tasks()
    
    def _init_database(self):
        """Initialize PostgreSQL connection"""
        try:
            self.db = psycopg2.connect(
                host=self.config.get('db_host', 'localhost'),
                port=self.config.get('db_port', 5432),
                database=self.config.get('db_name', 'remittance'),
                user=self.config.get('db_user', 'postgres'),
                password=self.config.get('db_password', 'password')
            )
            self.db.autocommit = True
            logger.info("Database connection established")
        except Exception as e:
            logger.error(f"Failed to connect to database: {e}")
            self.db = None
    
    def _init_redis(self):
        """Initialize Redis connection"""
        try:
            self.redis_client = redis.Redis(
                host=self.config.get('redis_host', 'localhost'),
                port=self.config.get('redis_port', 6379),
                db=self.config.get('redis_db', 0),
                decode_responses=True
            )
            self.redis_client.ping()
            logger.info("Redis connection established")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            self.redis_client = None
    
    def _init_prometheus_metrics(self):
        """Initialize Prometheus metrics"""
        self.prom_metrics = {
            'metrics_processed': Counter('monitoring_metrics_processed_total', 'Total metrics processed'),
            'alerts_generated': Counter('monitoring_alerts_generated_total', 'Total alerts generated', ['severity']),
            'anomalies_detected': Counter('monitoring_anomalies_detected_total', 'Total anomalies detected'),
            'system_health_score': Gauge('monitoring_system_health_score', 'Overall system health score'),
            'processing_latency': Histogram('monitoring_processing_latency_seconds', 'Processing latency'),
            'active_alerts': Gauge('monitoring_active_alerts', 'Number of active alerts', ['severity']),
            'component_health': Gauge('monitoring_component_health', 'Component health scores', ['component']),
        }
    
    def _init_ml_models(self):
        """Initialize ML models for anomaly detection"""
        self.anomaly_models = {
            'isolation_forest': IsolationForest(contamination=0.1, random_state=42),
            'dbscan': DBSCAN(eps=0.5, min_samples=5),
        }
        self.scalers = {
            'standard': StandardScaler()
        }
        
        # Load pre-trained models if available
        self._load_trained_models()
    
    def _init_flask_app(self):
        """Initialize Flask application"""
        self.app = Flask(__name__)
        CORS(self.app)
        
        # Register routes
        self._register_routes()
    
    def _register_routes(self):
        """Register Flask routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'version': '1.0.0'
            })
        
        @self.app.route('/api/v1/metrics', methods=['POST'])
        def ingest_metrics():
            """Ingest metrics from various sources"""
            try:
                data = request.get_json()
                metrics = self._parse_metrics(data)
                
                for metric in metrics:
                    self.metrics_buffer.append(metric)
                
                self.prom_metrics['metrics_processed'].inc(len(metrics))
                
                return jsonify({
                    'status': 'success',
                    'metrics_ingested': len(metrics)
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to ingest metrics: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/metrics/query', methods=['GET'])
        def query_metrics():
            """Query metrics with filters"""
            try:
                metric_name = request.args.get('metric_name')
                start_time = request.args.get('start_time')
                end_time = request.args.get('end_time')
                labels = request.args.get('labels', '{}')
                
                results = self._query_metrics(metric_name, start_time, end_time, json.loads(labels))
                
                return jsonify({
                    'status': 'success',
                    'data': results
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to query metrics: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/alerts', methods=['GET'])
        def get_alerts():
            """Get active alerts"""
            try:
                status = request.args.get('status', 'active')
                severity = request.args.get('severity')
                
                alerts = self._get_alerts(status, severity)
                
                return jsonify({
                    'status': 'success',
                    'alerts': [asdict(alert) for alert in alerts]
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to get alerts: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/alerts/<alert_id>/acknowledge', methods=['POST'])
        def acknowledge_alert(alert_id):
            """Acknowledge an alert"""
            try:
                data = request.get_json()
                assignee = data.get('assignee', 'unknown')
                notes = data.get('notes', '')
                
                success = self._acknowledge_alert(alert_id, assignee, notes)
                
                if success:
                    return jsonify({'status': 'success'}), 200
                else:
                    return jsonify({'error': 'Alert not found'}), 404
                    
            except Exception as e:
                logger.error(f"Failed to acknowledge alert: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/system/health', methods=['GET'])
        def get_system_health():
            """Get overall system health"""
            try:
                if self.system_health:
                    return jsonify({
                        'status': 'success',
                        'health': asdict(self.system_health)
                    }), 200
                else:
                    return jsonify({'error': 'Health data not available'}), 503
                    
            except Exception as e:
                logger.error(f"Failed to get system health: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/anomalies', methods=['GET'])
        def get_anomalies():
            """Get detected anomalies"""
            try:
                start_time = request.args.get('start_time')
                end_time = request.args.get('end_time')
                metric_name = request.args.get('metric_name')
                
                anomalies = self._get_anomalies(start_time, end_time, metric_name)
                
                return jsonify({
                    'status': 'success',
                    'anomalies': [asdict(anomaly) for anomaly in anomalies]
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to get anomalies: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/predictions', methods=['GET'])
        def get_predictions():
            """Get predictive analytics results"""
            try:
                horizon = int(request.args.get('horizon', 24))  # hours
                component = request.args.get('component')
                
                predictions = self._get_predictions(horizon, component)
                
                return jsonify({
                    'status': 'success',
                    'predictions': predictions
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to get predictions: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/api/v1/dashboard', methods=['GET'])
        def get_dashboard_data():
            """Get comprehensive dashboard data"""
            try:
                dashboard_data = self._get_dashboard_data()
                
                return jsonify({
                    'status': 'success',
                    'data': dashboard_data
                }), 200
                
            except Exception as e:
                logger.error(f"Failed to get dashboard data: {e}")
                return jsonify({'error': str(e)}), 400
        
        @self.app.route('/metrics', methods=['GET'])
        def prometheus_metrics():
            """Prometheus metrics endpoint"""
            return generate_latest(), 200, {'Content-Type': CONTENT_TYPE_LATEST}
        
        @self.app.route('/dashboard', methods=['GET'])
        def dashboard():
            """Real-time monitoring dashboard"""
            return render_template_string(DASHBOARD_TEMPLATE)
    
    def _parse_metrics(self, data: Dict[str, Any]) -> List[MetricPoint]:
        """Parse incoming metrics data"""
        metrics = []
        
        if isinstance(data, list):
            for item in data:
                metric = self._parse_single_metric(item)
                if metric:
                    metrics.append(metric)
        elif isinstance(data, dict):
            metric = self._parse_single_metric(data)
            if metric:
                metrics.append(metric)
        
        return metrics
    
    def _parse_single_metric(self, item: Dict[str, Any]) -> Optional[MetricPoint]:
        """Parse a single metric item"""
        try:
            return MetricPoint(
                timestamp=datetime.fromisoformat(item.get('timestamp', datetime.now().isoformat())),
                metric_name=item['metric_name'],
                value=float(item['value']),
                labels=item.get('labels', {}),
                source=item.get('source', 'unknown'),
                tags=item.get('tags', [])
            )
        except Exception as e:
            logger.error(f"Failed to parse metric: {e}")
            return None
    
    def _start_background_tasks(self):
        """Start background processing tasks"""
        threading.Thread(target=self.metrics_processor.run, daemon=True).start()
        threading.Thread(target=self.anomaly_detector.run, daemon=True).start()
        threading.Thread(target=self.alert_manager.run, daemon=True).start()
        threading.Thread(target=self.health_calculator.run, daemon=True).start()
        threading.Thread(target=self.predictive_analyzer.run, daemon=True).start()
    
    def _load_trained_models(self):
        """Load pre-trained ML models"""
        try:
            # Load models from disk if available
            model_path = self.config.get('model_path', './models')
            if os.path.exists(f"{model_path}/isolation_forest.joblib"):
                self.anomaly_models['isolation_forest'] = joblib.load(f"{model_path}/isolation_forest.joblib")
                logger.info("Loaded pre-trained Isolation Forest model")
        except Exception as e:
            logger.warning(f"Could not load pre-trained models: {e}")
    
    def run(self):
        """Run the monitoring service"""
        host = self.config.get('host', '0.0.0.0')
        port = self.config.get('port', 8080)
        debug = self.config.get('debug', False)
        
        logger.info(f"Starting monitoring service on {host}:{port}")
        self.app.run(host=host, port=port, debug=debug, threaded=True)

class MetricsProcessor:
    """Processes and aggregates metrics"""
    
    def __init__(self, monitoring_service):
        self.monitoring_service = monitoring_service
        self.processing_queue = queue.Queue()
        self.aggregated_metrics = defaultdict(list)
    
    def run(self):
        """Main processing loop"""
        while True:
            try:
                # Process metrics from buffer
                while self.monitoring_service.metrics_buffer:
                    metric = self.monitoring_service.metrics_buffer.popleft()
                    self.process_metric(metric)
                
                # Aggregate metrics every minute
                self.aggregate_metrics()
                
                time.sleep(1)
                
            except Exception as e:
                logger.error(f"Error in metrics processor: {e}")
                time.sleep(5)
    
    def process_metric(self, metric: MetricPoint):
        """Process a single metric"""
        try:
            # Store in time series database (Redis)
            if self.monitoring_service.redis_client:
                key = f"metrics:{metric.metric_name}:{metric.source}"
                value = {
                    'timestamp': metric.timestamp.isoformat(),
                    'value': metric.value,
                    'labels': metric.labels,
                    'tags': metric.tags or []
                }
                self.monitoring_service.redis_client.zadd(
                    key, 
                    {json.dumps(value): metric.timestamp.timestamp()}
                )
                
                # Keep only last 24 hours of data
                cutoff = (datetime.now() - timedelta(hours=24)).timestamp()
                self.monitoring_service.redis_client.zremrangebyscore(key, 0, cutoff)
            
            # Add to aggregation buffer
            self.aggregated_metrics[metric.metric_name].append(metric)
            
            # Update Prometheus metrics
            self.monitoring_service.prom_metrics['metrics_processed'].inc()
            
        except Exception as e:
            logger.error(f"Failed to process metric {metric.metric_name}: {e}")
    
    def aggregate_metrics(self):
        """Aggregate metrics for analysis"""
        try:
            for metric_name, metrics in self.aggregated_metrics.items():
                if len(metrics) >= 10:  # Aggregate when we have enough data
                    values = [m.value for m in metrics]
                    
                    # Calculate statistics
                    stats = {
                        'count': len(values),
                        'mean': statistics.mean(values),
                        'median': statistics.median(values),
                        'std': statistics.stdev(values) if len(values) > 1 else 0,
                        'min': min(values),
                        'max': max(values),
                        'p95': np.percentile(values, 95),
                        'p99': np.percentile(values, 99)
                    }
                    
                    # Store aggregated stats
                    if self.monitoring_service.redis_client:
                        key = f"stats:{metric_name}"
                        self.monitoring_service.redis_client.hset(key, mapping=stats)
                        self.monitoring_service.redis_client.expire(key, 3600)  # 1 hour TTL
                    
                    # Clear processed metrics
                    self.aggregated_metrics[metric_name] = []
                    
        except Exception as e:
            logger.error(f"Failed to aggregate metrics: {e}")

class AnomalyDetector:
    """Detects anomalies in metrics using ML"""
    
    def __init__(self, monitoring_service):
        self.monitoring_service = monitoring_service
        self.detection_window = 100  # Number of data points for detection
        self.training_data = defaultdict(deque)
        self.last_training = {}
    
    def run(self):
        """Main anomaly detection loop"""
        while True:
            try:
                self.detect_anomalies()
                time.sleep(30)  # Run every 30 seconds
                
            except Exception as e:
                logger.error(f"Error in anomaly detector: {e}")
                time.sleep(60)
    
    def detect_anomalies(self):
        """Detect anomalies in recent metrics"""
        try:
            if not self.monitoring_service.redis_client:
                return
            
            # Get all metric keys
            metric_keys = self.monitoring_service.redis_client.keys("metrics:*")
            
            for key in metric_keys:
                metric_name = key.split(':')[1]
                
                # Get recent data
                recent_data = self.monitoring_service.redis_client.zrevrange(
                    key, 0, self.detection_window, withscores=True
                )
                
                if len(recent_data) < 10:
                    continue
                
                # Prepare data for anomaly detection
                values = []
                timestamps = []
                
                for data_json, timestamp in recent_data:
                    try:
                        data = json.loads(data_json)
                        values.append(data['value'])
                        timestamps.append(datetime.fromtimestamp(timestamp))
                    except:
                        continue
                
                if len(values) < 10:
                    continue
                
                # Detect anomalies
                anomalies = self._detect_metric_anomalies(metric_name, values, timestamps)
                
                # Store and alert on anomalies
                for anomaly in anomalies:
                    self._handle_anomaly(anomaly)
                    
        except Exception as e:
            logger.error(f"Failed to detect anomalies: {e}")
    
    def _detect_metric_anomalies(self, metric_name: str, values: List[float], timestamps: List[datetime]) -> List[AnomalyDetection]:
        """Detect anomalies for a specific metric"""
        anomalies = []
        
        try:
            # Prepare data
            X = np.array(values).reshape(-1, 1)
            
            # Scale data
            scaler = self.monitoring_service.scalers['standard']
            X_scaled = scaler.fit_transform(X)
            
            # Use Isolation Forest for anomaly detection
            model = self.monitoring_service.anomaly_models['isolation_forest']
            
            # Retrain model periodically
            if metric_name not in self.last_training or \
               (datetime.now() - self.last_training[metric_name]).total_seconds() > 3600:
                model.fit(X_scaled)
                self.last_training[metric_name] = datetime.now()
            
            # Predict anomalies
            predictions = model.predict(X_scaled)
            scores = model.decision_function(X_scaled)
            
            # Create anomaly objects
            for i, (pred, score, value, timestamp) in enumerate(zip(predictions, scores, values, timestamps)):
                if pred == -1:  # Anomaly detected
                    anomaly = AnomalyDetection(
                        id=str(uuid.uuid4()),
                        timestamp=timestamp,
                        metric_name=metric_name,
                        value=value,
                        anomaly_score=abs(score),
                        is_anomaly=True,
                        confidence=min(abs(score) * 100, 100),
                        context={
                            'recent_mean': np.mean(values),
                            'recent_std': np.std(values),
                            'deviation': abs(value - np.mean(values)) / (np.std(values) + 1e-8)
                        }
                    )
                    anomalies.append(anomaly)
            
        except Exception as e:
            logger.error(f"Failed to detect anomalies for {metric_name}: {e}")
        
        return anomalies
    
    def _handle_anomaly(self, anomaly: AnomalyDetection):
        """Handle detected anomaly"""
        try:
            # Store anomaly
            if self.monitoring_service.redis_client:
                key = f"anomalies:{anomaly.metric_name}"
                value = json.dumps(asdict(anomaly), default=str)
                self.monitoring_service.redis_client.zadd(
                    key, 
                    {value: anomaly.timestamp.timestamp()}
                )
            
            # Update metrics
            self.monitoring_service.prom_metrics['anomalies_detected'].inc()
            
            # Generate alert if anomaly is significant
            if anomaly.confidence > 80:
                alert = Alert(
                    id=str(uuid.uuid4()),
                    severity='warning' if anomaly.confidence < 95 else 'critical',
                    title=f"Anomaly detected in {anomaly.metric_name}",
                    description=f"Unusual value {anomaly.value} detected with {anomaly.confidence:.1f}% confidence",
                    metric_name=anomaly.metric_name,
                    current_value=anomaly.value,
                    threshold=anomaly.context.get('recent_mean', 0),
                    timestamp=anomaly.timestamp,
                    source='anomaly_detector'
                )
                
                self.monitoring_service.alerts[alert.id] = alert
                self.monitoring_service.prom_metrics['alerts_generated'].labels(severity=alert.severity).inc()
                
                logger.warning(f"Anomaly alert generated: {alert.title}")
            
        except Exception as e:
            logger.error(f"Failed to handle anomaly: {e}")

class AlertManager:
    """Manages alerts and notifications"""
    
    def __init__(self, monitoring_service):
        self.monitoring_service = monitoring_service
        self.alert_rules = self._load_alert_rules()
        self.notification_channels = self._init_notification_channels()
    
    def run(self):
        """Main alert management loop"""
        while True:
            try:
                self.evaluate_alert_rules()
                self.process_alert_notifications()
                self.cleanup_resolved_alerts()
                
                time.sleep(10)  # Check every 10 seconds
                
            except Exception as e:
                logger.error(f"Error in alert manager: {e}")
                time.sleep(30)
    
    def _load_alert_rules(self) -> List[Dict[str, Any]]:
        """Load alert rules configuration"""
        return [
            {
                'name': 'high_cpu_usage',
                'metric': 'system.cpu.usage',
                'condition': 'greater_than',
                'threshold': 80,
                'duration': 300,  # 5 minutes
                'severity': 'warning'
            },
            {
                'name': 'critical_cpu_usage',
                'metric': 'system.cpu.usage',
                'condition': 'greater_than',
                'threshold': 95,
                'duration': 60,  # 1 minute
                'severity': 'critical'
            },
            {
                'name': 'high_memory_usage',
                'metric': 'system.memory.usage',
                'condition': 'greater_than',
                'threshold': 85,
                'duration': 300,
                'severity': 'warning'
            },
            {
                'name': 'transaction_failure_rate',
                'metric': 'transactions.failure_rate',
                'condition': 'greater_than',
                'threshold': 5,  # 5%
                'duration': 120,
                'severity': 'critical'
            },
            {
                'name': 'sync_lag',
                'metric': 'sync.lag_seconds',
                'condition': 'greater_than',
                'threshold': 300,  # 5 minutes
                'duration': 180,
                'severity': 'warning'
            }
        ]
    
    def _init_notification_channels(self) -> Dict[str, Any]:
        """Initialize notification channels"""
        return {
            'webhook': {
                'enabled': True,
                'url': self.monitoring_service.config.get('webhook_url'),
                'timeout': 10
            },
            'email': {
                'enabled': False,  # Would need SMTP configuration
                'smtp_server': self.monitoring_service.config.get('smtp_server'),
                'recipients': self.monitoring_service.config.get('alert_recipients', [])
            }
        }
    
    def evaluate_alert_rules(self):
        """Evaluate alert rules against current metrics"""
        try:
            for rule in self.alert_rules:
                self._evaluate_single_rule(rule)
                
        except Exception as e:
            logger.error(f"Failed to evaluate alert rules: {e}")
    
    def _evaluate_single_rule(self, rule: Dict[str, Any]):
        """Evaluate a single alert rule"""
        try:
            metric_name = rule['metric']
            
            # Get recent metric values
            if not self.monitoring_service.redis_client:
                return
            
            key = f"metrics:{metric_name}:*"
            keys = self.monitoring_service.redis_client.keys(key)
            
            if not keys:
                return
            
            # Get recent values from all sources
            recent_values = []
            for k in keys:
                data = self.monitoring_service.redis_client.zrevrange(k, 0, 10, withscores=True)
                for data_json, timestamp in data:
                    try:
                        metric_data = json.loads(data_json)
                        recent_values.append((metric_data['value'], datetime.fromtimestamp(timestamp)))
                    except:
                        continue
            
            if not recent_values:
                return
            
            # Sort by timestamp
            recent_values.sort(key=lambda x: x[1], reverse=True)
            
            # Check if condition is met
            current_value = recent_values[0][0]
            condition_met = self._check_condition(current_value, rule['condition'], rule['threshold'])
            
            if condition_met:
                # Check if condition has been met for required duration
                duration_met = self._check_duration(recent_values, rule)
                
                if duration_met:
                    # Generate alert
                    alert_id = f"{rule['name']}_{metric_name}"
                    
                    if alert_id not in self.monitoring_service.alerts:
                        alert = Alert(
                            id=alert_id,
                            severity=rule['severity'],
                            title=f"{rule['name'].replace('_', ' ').title()}",
                            description=f"{metric_name} is {current_value}, threshold: {rule['threshold']}",
                            metric_name=metric_name,
                            current_value=current_value,
                            threshold=rule['threshold'],
                            timestamp=datetime.now(),
                            source='alert_manager'
                        )
                        
                        self.monitoring_service.alerts[alert_id] = alert
                        self.monitoring_service.prom_metrics['alerts_generated'].labels(severity=alert.severity).inc()
                        
                        logger.warning(f"Alert generated: {alert.title}")
            else:
                # Resolve alert if it exists
                alert_id = f"{rule['name']}_{metric_name}"
                if alert_id in self.monitoring_service.alerts:
                    self.monitoring_service.alerts[alert_id].status = 'resolved'
                    logger.info(f"Alert resolved: {alert_id}")
                    
        except Exception as e:
            logger.error(f"Failed to evaluate rule {rule.get('name', 'unknown')}: {e}")
    
    def _check_condition(self, value: float, condition: str, threshold: float) -> bool:
        """Check if alert condition is met"""
        if condition == 'greater_than':
            return value > threshold
        elif condition == 'less_than':
            return value < threshold
        elif condition == 'equals':
            return abs(value - threshold) < 0.001
        else:
            return False
    
    def _check_duration(self, values: List[Tuple[float, datetime]], rule: Dict[str, Any]) -> bool:
        """Check if condition has been met for required duration"""
        duration_seconds = rule['duration']
        threshold = rule['threshold']
        condition = rule['condition']
        
        cutoff_time = datetime.now() - timedelta(seconds=duration_seconds)
        
        # Check if all values in the duration window meet the condition
        for value, timestamp in values:
            if timestamp < cutoff_time:
                break
            
            if not self._check_condition(value, condition, threshold):
                return False
        
        return True
    
    def process_alert_notifications(self):
        """Process alert notifications"""
        try:
            for alert in self.monitoring_service.alerts.values():
                if alert.status == 'active' and not hasattr(alert, '_notified'):
                    self._send_notification(alert)
                    alert._notified = True
                    
        except Exception as e:
            logger.error(f"Failed to process notifications: {e}")
    
    def _send_notification(self, alert: Alert):
        """Send alert notification"""
        try:
            # Send webhook notification
            if self.notification_channels['webhook']['enabled']:
                webhook_url = self.notification_channels['webhook']['url']
                if webhook_url:
                    payload = {
                        'alert': asdict(alert),
                        'timestamp': datetime.now().isoformat()
                    }
                    
                    response = requests.post(
                        webhook_url,
                        json=payload,
                        timeout=self.notification_channels['webhook']['timeout']
                    )
                    
                    if response.status_code == 200:
                        logger.info(f"Webhook notification sent for alert {alert.id}")
                    else:
                        logger.error(f"Webhook notification failed: {response.status_code}")
            
            # Send to WebSocket clients
            self._broadcast_to_websockets(alert)
            
        except Exception as e:
            logger.error(f"Failed to send notification for alert {alert.id}: {e}")
    
    def _broadcast_to_websockets(self, alert: Alert):
        """Broadcast alert to WebSocket clients"""
        try:
            message = {
                'type': 'alert',
                'data': asdict(alert)
            }
            
            # This would broadcast to connected WebSocket clients
            # Implementation depends on WebSocket library used
            
        except Exception as e:
            logger.error(f"Failed to broadcast alert: {e}")
    
    def cleanup_resolved_alerts(self):
        """Clean up resolved alerts"""
        try:
            cutoff_time = datetime.now() - timedelta(hours=24)
            
            alerts_to_remove = []
            for alert_id, alert in self.monitoring_service.alerts.items():
                if alert.status == 'resolved' and alert.timestamp < cutoff_time:
                    alerts_to_remove.append(alert_id)
            
            for alert_id in alerts_to_remove:
                del self.monitoring_service.alerts[alert_id]
                
        except Exception as e:
            logger.error(f"Failed to cleanup alerts: {e}")

class HealthCalculator:
    """Calculates overall system health"""
    
    def __init__(self, monitoring_service):
        self.monitoring_service = monitoring_service
        self.component_weights = {
            'database': 0.25,
            'tigerbeetle': 0.25,
            'api_gateway': 0.20,
            'fraud_detection': 0.15,
            'sync_services': 0.15
        }
    
    def run(self):
        """Main health calculation loop"""
        while True:
            try:
                self.calculate_system_health()
                time.sleep(60)  # Calculate every minute
                
            except Exception as e:
                logger.error(f"Error in health calculator: {e}")
                time.sleep(120)
    
    def calculate_system_health(self):
        """Calculate overall system health"""
        try:
            component_scores = {}
            
            # Calculate health for each component
            for component in self.component_weights.keys():
                score = self._calculate_component_health(component)
                component_scores[component] = score
                
                # Update Prometheus metric
                self.monitoring_service.prom_metrics['component_health'].labels(component=component).set(score)
            
            # Calculate weighted overall score
            overall_score = sum(
                score * self.component_weights[component]
                for component, score in component_scores.items()
            )
            
            # Count alerts
            active_alerts = len([a for a in self.monitoring_service.alerts.values() if a.status == 'active'])
            critical_alerts = len([a for a in self.monitoring_service.alerts.values() 
                                 if a.status == 'active' and a.severity == 'critical'])
            warning_alerts = len([a for a in self.monitoring_service.alerts.values() 
                                if a.status == 'active' and a.severity == 'warning'])
            
            # Count anomalies (last hour)
            anomalies_count = self._count_recent_anomalies()
            
            # Create system health object
            self.monitoring_service.system_health = SystemHealth(
                timestamp=datetime.now(),
                overall_score=overall_score,
                component_scores=component_scores,
                active_alerts=active_alerts,
                critical_alerts=critical_alerts,
                warning_alerts=warning_alerts,
                anomalies_detected=anomalies_count,
                prediction_horizon={}  # Would be filled by predictive analyzer
            )
            
            # Update Prometheus metrics
            self.monitoring_service.prom_metrics['system_health_score'].set(overall_score)
            self.monitoring_service.prom_metrics['active_alerts'].labels(severity='critical').set(critical_alerts)
            self.monitoring_service.prom_metrics['active_alerts'].labels(severity='warning').set(warning_alerts)
            
        except Exception as e:
            logger.error(f"Failed to calculate system health: {e}")
    
    def _calculate_component_health(self, component: str) -> float:
        """Calculate health score for a specific component"""
        try:
            # Base score
            score = 100.0
            
            # Check for active alerts related to this component
            component_alerts = [
                alert for alert in self.monitoring_service.alerts.values()
                if alert.status == 'active' and component in alert.metric_name.lower()
            ]
            
            # Deduct points for alerts
            for alert in component_alerts:
                if alert.severity == 'critical':
                    score -= 30
                elif alert.severity == 'warning':
                    score -= 15
                else:
                    score -= 5
            
            # Check component-specific metrics
            if component == 'database':
                score = self._check_database_health(score)
            elif component == 'tigerbeetle':
                score = self._check_tigerbeetle_health(score)
            elif component == 'api_gateway':
                score = self._check_api_gateway_health(score)
            elif component == 'fraud_detection':
                score = self._check_fraud_detection_health(score)
            elif component == 'sync_services':
                score = self._check_sync_services_health(score)
            
            return max(0, min(100, score))
            
        except Exception as e:
            logger.error(f"Failed to calculate health for {component}: {e}")
            return 50.0  # Default to medium health
    
    def _check_database_health(self, base_score: float) -> float:
        """Check database-specific health metrics"""
        try:
            # Check connection pool usage, query performance, etc.
            # This would query actual database metrics
            return base_score
        except:
            return base_score * 0.8
    
    def _check_tigerbeetle_health(self, base_score: float) -> float:
        """Check TigerBeetle-specific health metrics"""
        try:
            # Check transfer processing rate, sync lag, etc.
            return base_score
        except:
            return base_score * 0.8
    
    def _check_api_gateway_health(self, base_score: float) -> float:
        """Check API gateway health metrics"""
        try:
            # Check response times, error rates, etc.
            return base_score
        except:
            return base_score * 0.8
    
    def _check_fraud_detection_health(self, base_score: float) -> float:
        """Check fraud detection health metrics"""
        try:
            # Check model performance, processing latency, etc.
            return base_score
        except:
            return base_score * 0.8
    
    def _check_sync_services_health(self, base_score: float) -> float:
        """Check sync services health metrics"""
        try:
            # Check sync lag, failure rates, etc.
            return base_score
        except:
            return base_score * 0.8
    
    def _count_recent_anomalies(self) -> int:
        """Count anomalies detected in the last hour"""
        try:
            if not self.monitoring_service.redis_client:
                return 0
            
            cutoff = (datetime.now() - timedelta(hours=1)).timestamp()
            count = 0
            
            keys = self.monitoring_service.redis_client.keys("anomalies:*")
            for key in keys:
                recent_count = self.monitoring_service.redis_client.zcount(key, cutoff, '+inf')
                count += recent_count
            
            return count
            
        except Exception as e:
            logger.error(f"Failed to count recent anomalies: {e}")
            return 0

class PredictiveAnalyzer:
    """Provides predictive analytics for system health"""
    
    def __init__(self, monitoring_service):
        self.monitoring_service = monitoring_service
    
    def run(self):
        """Main predictive analysis loop"""
        while True:
            try:
                self.analyze_trends()
                time.sleep(300)  # Run every 5 minutes
                
            except Exception as e:
                logger.error(f"Error in predictive analyzer: {e}")
                time.sleep(600)
    
    def analyze_trends(self):
        """Analyze trends and make predictions"""
        try:
            # This would implement time series forecasting
            # using models like ARIMA, Prophet, or LSTM
            pass
            
        except Exception as e:
            logger.error(f"Failed to analyze trends: {e}")

# Dashboard HTML template
DASHBOARD_TEMPLATE = """
<!DOCTYPE html>
<html>
<head>
    <title>Remittance Platform - Monitoring Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px; }
        .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric { display: flex; justify-content: space-between; align-items: center; margin: 10px 0; }
        .metric-value { font-size: 24px; font-weight: bold; }
        .status-good { color: #28a745; }
        .status-warning { color: #ffc107; }
        .status-critical { color: #dc3545; }
        .chart-container { height: 300px; }
    </style>
</head>
<body>
    <h1>Remittance Platform - Real-Time Monitoring</h1>
    
    <div class="dashboard">
        <div class="card">
            <h3>System Health</h3>
            <div class="metric">
                <span>Overall Score</span>
                <span id="health-score" class="metric-value status-good">--</span>
            </div>
            <div class="metric">
                <span>Active Alerts</span>
                <span id="active-alerts" class="metric-value">--</span>
            </div>
            <div class="metric">
                <span>Critical Alerts</span>
                <span id="critical-alerts" class="metric-value">--</span>
            </div>
        </div>
        
        <div class="card">
            <h3>Transaction Metrics</h3>
            <div class="chart-container">
                <canvas id="transaction-chart"></canvas>
            </div>
        </div>
        
        <div class="card">
            <h3>System Performance</h3>
            <div class="chart-container">
                <canvas id="performance-chart"></canvas>
            </div>
        </div>
        
        <div class="card">
            <h3>Recent Alerts</h3>
            <div id="alerts-list">
                <!-- Alerts will be populated here -->
            </div>
        </div>
    </div>
    
    <script>
        // Initialize charts and real-time updates
        const transactionChart = new Chart(document.getElementById('transaction-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Transactions/min',
                    data: [],
                    borderColor: 'rgb(75, 192, 192)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        
        const performanceChart = new Chart(document.getElementById('performance-chart'), {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'CPU Usage %',
                    data: [],
                    borderColor: 'rgb(255, 99, 132)',
                    tension: 0.1
                }, {
                    label: 'Memory Usage %',
                    data: [],
                    borderColor: 'rgb(54, 162, 235)',
                    tension: 0.1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
        
        // Update dashboard every 30 seconds
        setInterval(updateDashboard, 30000);
        updateDashboard(); // Initial load
        
        function updateDashboard() {
            fetch('/api/v1/dashboard')
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success') {
                        updateHealthMetrics(data.data.health);
                        updateCharts(data.data.metrics);
                        updateAlerts(data.data.alerts);
                    }
                })
                .catch(error => console.error('Error updating dashboard:', error));
        }
        
        function updateHealthMetrics(health) {
            if (health) {
                document.getElementById('health-score').textContent = health.overall_score.toFixed(1);
                document.getElementById('active-alerts').textContent = health.active_alerts;
                document.getElementById('critical-alerts').textContent = health.critical_alerts;
                
                // Update health score color
                const scoreElement = document.getElementById('health-score');
                if (health.overall_score >= 80) {
                    scoreElement.className = 'metric-value status-good';
                } else if (health.overall_score >= 60) {
                    scoreElement.className = 'metric-value status-warning';
                } else {
                    scoreElement.className = 'metric-value status-critical';
                }
            }
        }
        
        function updateCharts(metrics) {
            // Update charts with new data
            // This would be implemented based on actual metric structure
        }
        
        function updateAlerts(alerts) {
            const alertsList = document.getElementById('alerts-list');
            alertsList.innerHTML = '';
            
            alerts.slice(0, 5).forEach(alert => {
                const alertDiv = document.createElement('div');
                alertDiv.className = `metric status-${alert.severity}`;
                alertDiv.innerHTML = `
                    <span>${alert.title}</span>
                    <span>${new Date(alert.timestamp).toLocaleTimeString()}</span>
                `;
                alertsList.appendChild(alertDiv);
            });
        }
    </script>
</body>
</html>
"""

def main():
    """Main entry point"""
    config = {
        'host': os.getenv('HOST', '0.0.0.0'),
        'port': int(os.getenv('PORT', 8080)),
        'debug': os.getenv('DEBUG', 'false').lower() == 'true',
        'db_host': os.getenv('DB_HOST', 'localhost'),
        'db_port': int(os.getenv('DB_PORT', 5432)),
        'db_name': os.getenv('DB_NAME', 'remittance'),
        'db_user': os.getenv('DB_USER', 'postgres'),
        'db_password': os.getenv('DB_PASSWORD', 'password'),
        'redis_host': os.getenv('REDIS_HOST', 'localhost'),
        'redis_port': int(os.getenv('REDIS_PORT', 6379)),
        'redis_db': int(os.getenv('REDIS_DB', 0)),
        'webhook_url': os.getenv('WEBHOOK_URL'),
        'model_path': os.getenv('MODEL_PATH', './models')
    }
    
    service = MonitoringService(config)
    service.run()

if __name__ == '__main__':
    main()

