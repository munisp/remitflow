#!/usr/bin/env python3
"""
Edge Computing Service for Remittance Platform
Provides edge computing capabilities for distributed processing and real-time analytics
"""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import uuid

import psycopg2
import redis
from flask import Flask, request, jsonify
from flask_cors import CORS
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

class EdgeComputingService:
    def __init__(self):
        self.db_connection = None
        self.redis_client = None
        self.anomaly_detector = None
        self.scaler = None
        self.initialize_connections()
        self.initialize_ml_models()
        self.initialize_database()
    
    def initialize_connections(self):
        """Initialize database and Redis connections"""
        try:
            # PostgreSQL connection
            self.db_connection = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=os.getenv('DB_PORT', '5432'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', 'password'),
                database=os.getenv('DB_NAME', 'remittance')
            )
            
            # Redis connection
            self.redis_client = redis.Redis(
                host=os.getenv('REDIS_HOST', 'localhost'),
                port=int(os.getenv('REDIS_PORT', '6379')),
                db=0,
                decode_responses=True
            )
            
            logger.info("Database and Redis connections initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize connections: {e}")
            raise
    
    def initialize_ml_models(self):
        """Initialize machine learning models for edge processing"""
        try:
            # Anomaly detection model
            self.anomaly_detector = IsolationForest(
                contamination=0.1,
                random_state=42,
                n_estimators=100
            )
            
            # Data scaler
            self.scaler = StandardScaler()
            
            # Train with sample data (in production, load pre-trained models)
            sample_data = np.random.normal(0, 1, (1000, 5))
            self.scaler.fit(sample_data)
            self.anomaly_detector.fit(self.scaler.transform(sample_data))
            
            logger.info("ML models initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize ML models: {e}")
            raise
    
    def initialize_database(self):
        """Initialize database tables"""
        try:
            cursor = self.db_connection.cursor()
            
            # Edge nodes table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS edge_nodes (
                    id SERIAL PRIMARY KEY,
                    node_id VARCHAR(50) UNIQUE NOT NULL,
                    location VARCHAR(100) NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'active',
                    capabilities JSONB,
                    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Edge processing jobs table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS edge_processing_jobs (
                    id SERIAL PRIMARY KEY,
                    job_id VARCHAR(50) UNIQUE NOT NULL,
                    node_id VARCHAR(50) NOT NULL,
                    job_type VARCHAR(50) NOT NULL,
                    input_data JSONB NOT NULL,
                    output_data JSONB,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    priority INTEGER DEFAULT 5,
                    started_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (node_id) REFERENCES edge_nodes(node_id)
                )
            """)
            
            # Edge analytics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS edge_analytics (
                    id SERIAL PRIMARY KEY,
                    node_id VARCHAR(50) NOT NULL,
                    metric_type VARCHAR(50) NOT NULL,
                    metric_value DECIMAL(15,4) NOT NULL,
                    metadata JSONB,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (node_id) REFERENCES edge_nodes(node_id)
                )
            """)
            
            # Edge cache table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS edge_cache (
                    id SERIAL PRIMARY KEY,
                    cache_key VARCHAR(200) UNIQUE NOT NULL,
                    cache_value JSONB NOT NULL,
                    node_id VARCHAR(50) NOT NULL,
                    ttl INTEGER DEFAULT 3600,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 hour'),
                    FOREIGN KEY (node_id) REFERENCES edge_nodes(node_id)
                )
            """)
            
            self.db_connection.commit()
            cursor.close()
            
            # Insert default edge nodes
            self.insert_default_edge_nodes()
            
            logger.info("Database tables initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
            self.db_connection.rollback()
            raise
    
    def insert_default_edge_nodes(self):
        """Insert default edge nodes"""
        try:
            cursor = self.db_connection.cursor()
            
            default_nodes = [
                {
                    'node_id': 'edge-node-lagos-01',
                    'location': 'Lagos, Nigeria',
                    'capabilities': {
                        'processing_power': 'high',
                        'storage': '1TB',
                        'network': 'fiber',
                        'services': ['transaction_processing', 'fraud_detection', 'analytics']
                    }
                },
                {
                    'node_id': 'edge-node-abuja-01',
                    'location': 'Abuja, Nigeria',
                    'capabilities': {
                        'processing_power': 'medium',
                        'storage': '500GB',
                        'network': '4G',
                        'services': ['transaction_processing', 'customer_service']
                    }
                },
                {
                    'node_id': 'edge-node-kano-01',
                    'location': 'Kano, Nigeria',
                    'capabilities': {
                        'processing_power': 'medium',
                        'storage': '500GB',
                        'network': '4G',
                        'services': ['transaction_processing', 'data_sync']
                    }
                }
            ]
            
            for node in default_nodes:
                cursor.execute("""
                    INSERT INTO edge_nodes (node_id, location, capabilities)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (node_id) DO UPDATE SET
                        location = EXCLUDED.location,
                        capabilities = EXCLUDED.capabilities,
                        updated_at = CURRENT_TIMESTAMP
                """, (node['node_id'], node['location'], json.dumps(node['capabilities'])))
            
            self.db_connection.commit()
            cursor.close()
            
            logger.info("Default edge nodes inserted successfully")
        except Exception as e:
            logger.error(f"Failed to insert default edge nodes: {e}")
            self.db_connection.rollback()
    
    def process_real_time_transaction(self, transaction_data: Dict) -> Dict:
        """Process transaction in real-time at edge"""
        try:
            # Extract features for anomaly detection
            features = [
                transaction_data.get('amount', 0),
                transaction_data.get('hour_of_day', 12),
                transaction_data.get('day_of_week', 1),
                transaction_data.get('agent_transaction_count', 0),
                transaction_data.get('customer_transaction_count', 0)
            ]
            
            # Scale features
            scaled_features = self.scaler.transform([features])
            
            # Detect anomalies
            anomaly_score = self.anomaly_detector.decision_function(scaled_features)[0]
            is_anomaly = self.anomaly_detector.predict(scaled_features)[0] == -1
            
            # Calculate risk score
            risk_score = max(0, min(100, (1 - anomaly_score) * 50))
            
            result = {
                'transaction_id': transaction_data.get('transaction_id'),
                'risk_score': float(risk_score),
                'is_anomaly': bool(is_anomaly),
                'anomaly_score': float(anomaly_score),
                'processing_time_ms': 15,  # Simulated edge processing time
                'processed_at': datetime.now().isoformat(),
                'node_id': 'edge-node-lagos-01'
            }
            
            # Cache result in Redis
            cache_key = f"transaction_analysis:{transaction_data.get('transaction_id')}"
            self.redis_client.setex(cache_key, 3600, json.dumps(result))
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to process real-time transaction: {e}")
            return {
                'transaction_id': transaction_data.get('transaction_id'),
                'error': str(e),
                'processed_at': datetime.now().isoformat()
            }
    
    def process_batch_analytics(self, data_batch: List[Dict]) -> Dict:
        """Process batch analytics at edge"""
        try:
            if not data_batch:
                return {'error': 'Empty data batch'}
            
            df = pd.DataFrame(data_batch)
            
            # Calculate analytics
            analytics = {
                'total_transactions': len(df),
                'total_amount': float(df['amount'].sum()) if 'amount' in df.columns else 0,
                'average_amount': float(df['amount'].mean()) if 'amount' in df.columns else 0,
                'unique_agents': df['agent_id'].nunique() if 'agent_id' in df.columns else 0,
                'unique_customers': df['customer_id'].nunique() if 'customer_id' in df.columns else 0,
                'success_rate': float((df['status'] == 'completed').mean() * 100) if 'status' in df.columns else 0,
                'processing_time_ms': 250,  # Simulated batch processing time
                'processed_at': datetime.now().isoformat(),
                'node_id': 'edge-node-lagos-01'
            }
            
            # Store analytics in database
            cursor = self.db_connection.cursor()
            for metric, value in analytics.items():
                if metric not in ['processing_time_ms', 'processed_at', 'node_id']:
                    cursor.execute("""
                        INSERT INTO edge_analytics (node_id, metric_type, metric_value, metadata)
                        VALUES (%s, %s, %s, %s)
                    """, ('edge-node-lagos-01', metric, value, json.dumps({'batch_size': len(data_batch)})))
            
            self.db_connection.commit()
            cursor.close()
            
            return analytics
            
        except Exception as e:
            logger.error(f"Failed to process batch analytics: {e}")
            return {'error': str(e)}
    
    def get_edge_node_status(self, node_id: str) -> Dict:
        """Get edge node status and metrics"""
        try:
            cursor = self.db_connection.cursor()
            
            # Get node information
            cursor.execute("""
                SELECT node_id, location, status, capabilities, last_heartbeat, created_at
                FROM edge_nodes WHERE node_id = %s
            """, (node_id,))
            
            node_data = cursor.fetchone()
            if not node_data:
                return {'error': 'Node not found'}
            
            # Get recent analytics
            cursor.execute("""
                SELECT metric_type, metric_value, timestamp
                FROM edge_analytics 
                WHERE node_id = %s AND timestamp >= %s
                ORDER BY timestamp DESC
                LIMIT 10
            """, (node_id, datetime.now() - timedelta(hours=1)))
            
            analytics = cursor.fetchall()
            
            # Get active jobs
            cursor.execute("""
                SELECT COUNT(*) FROM edge_processing_jobs
                WHERE node_id = %s AND status IN ('pending', 'running')
            """, (node_id,))
            
            active_jobs = cursor.fetchone()[0]
            
            cursor.close()
            
            return {
                'node_id': node_data[0],
                'location': node_data[1],
                'status': node_data[2],
                'capabilities': node_data[3],
                'last_heartbeat': node_data[4].isoformat() if node_data[4] else None,
                'created_at': node_data[5].isoformat() if node_data[5] else None,
                'active_jobs': active_jobs,
                'recent_analytics': [
                    {
                        'metric_type': row[0],
                        'metric_value': float(row[1]),
                        'timestamp': row[2].isoformat()
                    } for row in analytics
                ]
            }
            
        except Exception as e:
            logger.error(f"Failed to get edge node status: {e}")
            return {'error': str(e)}

# Initialize service
edge_service = EdgeComputingService()

# API Routes
@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    try:
        # Test database connection
        cursor = edge_service.db_connection.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        
        # Test Redis connection
        edge_service.redis_client.ping()
        
        return jsonify({
            'status': 'healthy',
            'service': 'edge-computing-service',
            'timestamp': datetime.now().isoformat(),
            'database': 'connected',
            'redis': 'connected',
            'ml_models': 'loaded'
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 503

@app.route('/api/v1/edge/nodes', methods=['GET'])
def get_edge_nodes():
    """Get all edge nodes"""
    try:
        cursor = edge_service.db_connection.cursor()
        cursor.execute("""
            SELECT node_id, location, status, capabilities, last_heartbeat, created_at
            FROM edge_nodes
            ORDER BY created_at DESC
        """)
        
        nodes = []
        for row in cursor.fetchall():
            nodes.append({
                'node_id': row[0],
                'location': row[1],
                'status': row[2],
                'capabilities': row[3],
                'last_heartbeat': row[4].isoformat() if row[4] else None,
                'created_at': row[5].isoformat() if row[5] else None
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': nodes,
            'count': len(nodes)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/nodes/<node_id>/status', methods=['GET'])
def get_node_status(node_id):
    """Get specific edge node status"""
    try:
        status = edge_service.get_edge_node_status(node_id)
        if 'error' in status:
            return jsonify(status), 404
        
        return jsonify({
            'status': 'success',
            'data': status
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/process/transaction', methods=['POST'])
def process_transaction():
    """Process real-time transaction at edge"""
    try:
        transaction_data = request.get_json()
        if not transaction_data:
            return jsonify({'error': 'No transaction data provided'}), 400
        
        result = edge_service.process_real_time_transaction(transaction_data)
        
        return jsonify({
            'status': 'success',
            'data': result
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/process/batch', methods=['POST'])
def process_batch():
    """Process batch analytics at edge"""
    try:
        batch_data = request.get_json()
        if not batch_data or 'data' not in batch_data:
            return jsonify({'error': 'No batch data provided'}), 400
        
        result = edge_service.process_batch_analytics(batch_data['data'])
        
        return jsonify({
            'status': 'success',
            'data': result
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/analytics', methods=['GET'])
def get_edge_analytics():
    """Get edge analytics"""
    try:
        node_id = request.args.get('node_id')
        metric_type = request.args.get('metric_type')
        hours = int(request.args.get('hours', 24))
        
        cursor = edge_service.db_connection.cursor()
        
        query = """
            SELECT node_id, metric_type, metric_value, metadata, timestamp
            FROM edge_analytics
            WHERE timestamp >= %s
        """
        params = [datetime.now() - timedelta(hours=hours)]
        
        if node_id:
            query += " AND node_id = %s"
            params.append(node_id)
        
        if metric_type:
            query += " AND metric_type = %s"
            params.append(metric_type)
        
        query += " ORDER BY timestamp DESC LIMIT 1000"
        
        cursor.execute(query, params)
        
        analytics = []
        for row in cursor.fetchall():
            analytics.append({
                'node_id': row[0],
                'metric_type': row[1],
                'metric_value': float(row[2]),
                'metadata': row[3],
                'timestamp': row[4].isoformat()
            })
        
        cursor.close()
        
        return jsonify({
            'status': 'success',
            'data': analytics,
            'count': len(analytics)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/cache/<cache_key>', methods=['GET'])
def get_cache(cache_key):
    """Get cached data"""
    try:
        cached_data = edge_service.redis_client.get(cache_key)
        if cached_data:
            return jsonify({
                'status': 'success',
                'data': json.loads(cached_data),
                'cached': True
            })
        else:
            return jsonify({
                'status': 'success',
                'data': None,
                'cached': False
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/cache/<cache_key>', methods=['POST'])
def set_cache(cache_key):
    """Set cached data"""
    try:
        data = request.get_json()
        ttl = data.get('ttl', 3600)
        value = data.get('value')
        
        if value is None:
            return jsonify({'error': 'No value provided'}), 400
        
        edge_service.redis_client.setex(cache_key, ttl, json.dumps(value))
        
        return jsonify({
            'status': 'success',
            'message': 'Cache set successfully'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/v1/edge/dashboard', methods=['GET'])
def get_dashboard():
    """Get edge computing dashboard summary"""
    try:
        cursor = edge_service.db_connection.cursor()
        
        # Get node summary
        cursor.execute("""
            SELECT COUNT(*), 
                   SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN last_heartbeat >= NOW() - INTERVAL '5 minutes' THEN 1 ELSE 0 END)
            FROM edge_nodes
        """)
        
        node_stats = cursor.fetchone()
        
        # Get job summary
        cursor.execute("""
            SELECT COUNT(*),
                   SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END),
                   SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)
            FROM edge_processing_jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
        """)
        
        job_stats = cursor.fetchone()
        
        # Get analytics summary
        cursor.execute("""
            SELECT COUNT(*), AVG(metric_value)
            FROM edge_analytics
            WHERE timestamp >= NOW() - INTERVAL '1 hour'
        """)
        
        analytics_stats = cursor.fetchone()
        
        cursor.close()
        
        summary = {
            'nodes': {
                'total': node_stats[0] if node_stats[0] else 0,
                'active': node_stats[1] if node_stats[1] else 0,
                'online': node_stats[2] if node_stats[2] else 0
            },
            'jobs': {
                'total_24h': job_stats[0] if job_stats[0] else 0,
                'pending': job_stats[1] if job_stats[1] else 0,
                'running': job_stats[2] if job_stats[2] else 0,
                'completed': job_stats[3] if job_stats[3] else 0
            },
            'analytics': {
                'metrics_1h': analytics_stats[0] if analytics_stats[0] else 0,
                'average_value': float(analytics_stats[1]) if analytics_stats[1] else 0
            },
            'generated_at': datetime.now().isoformat()
        }
        
        return jsonify({
            'status': 'success',
            'data': summary
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.getenv('PORT', 8001))
    app.run(host='0.0.0.0', port=port, debug=False)

