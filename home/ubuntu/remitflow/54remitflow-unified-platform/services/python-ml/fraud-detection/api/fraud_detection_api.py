"""
Fraud Detection API Service
RESTful API for real-time fraud detection and risk assessment
"""

from flask import Flask, request, jsonify, g
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import redis
import json
import logging
import traceback
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import numpy as np
import pandas as pd
from dataclasses import asdict
import asyncio
import aioredis
from concurrent.futures import ThreadPoolExecutor
import threading
import time
import os
import sys

# Add the models directory to the path
sys.path.append(os.path.join(os.path.dirname(__file__), '..'))

from models.fraud_models import (
    HybridFraudDetector, TransactionFeatures, FraudPrediction,
    FraudType, RiskLevel
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize Flask app
app = Flask(__name__)
CORS(app, origins="*")

# Configuration
app.config.update({
    'SECRET_KEY': os.environ.get('SECRET_KEY', 'fraud-detection-secret-key'),
    'REDIS_URL': os.environ.get('REDIS_URL', 'redis://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")"):6379/0'),
    'MODEL_PATH': os.environ.get('MODEL_PATH', '/tmp/fraud_models.pkl'),
    'MAX_REQUESTS_PER_MINUTE': int(os.environ.get('MAX_REQUESTS_PER_MINUTE', '1000')),
    'ENABLE_ASYNC_PROCESSING': os.environ.get('ENABLE_ASYNC_PROCESSING', 'true').lower() == 'true',
    'BATCH_SIZE': int(os.environ.get('BATCH_SIZE', '100')),
    'MODEL_RETRAIN_INTERVAL': int(os.environ.get('MODEL_RETRAIN_INTERVAL', '3600')),  # 1 hour
})

# Initialize Redis for caching and rate limiting
try:
    redis_client = redis.from_url(app.config['REDIS_URL'])
    redis_client.ping()
    logger.info("Redis connection established")
except Exception as e:
    logger.error(f"Redis connection failed: {e}")
    redis_client = None

# Initialize rate limiter
limiter = Limiter(
    app,
    key_func=get_remote_address,
    default_limits=[f"{app.config['MAX_REQUESTS_PER_MINUTE']} per minute"],
    storage_uri=app.config['REDIS_URL'] if redis_client else None
)

# Global fraud detector instance
fraud_detector = None
model_lock = threading.Lock()
last_model_update = None

# Thread pool for async processing
executor = ThreadPoolExecutor(max_workers=10)

class FraudDetectionService:
    """Main fraud detection service class"""
    
    def __init__(self):
        self.detector = None
        self.model_metrics = {
            'total_predictions': 0,
            'fraud_detected': 0,
            'false_positives': 0,
            'false_negatives': 0,
            'avg_response_time': 0.0,
            'model_accuracy': 0.0,
            'last_updated': datetime.now()
        }
        self.prediction_cache = {}
        self.cache_ttl = 300  # 5 minutes
        
    def initialize_detector(self) -> bool:
        """Initialize the fraud detection models"""
        try:
            global fraud_detector, last_model_update
            
            with model_lock:
                fraud_detector = HybridFraudDetector()
                
                # Try to load existing models
                if os.path.exists(app.config['MODEL_PATH']):
                    fraud_detector.load_models(app.config['MODEL_PATH'])
                    logger.info("Loaded existing fraud detection models")
                else:
                    # Train with sample data if no models exist
                    self._train_initial_models()
                    logger.info("Trained initial fraud detection models")
                
                last_model_update = datetime.now()
                self.detector = fraud_detector
                
            return True
            
        except Exception as e:
            logger.error(f"Failed to initialize fraud detector: {e}")
            return False
    
    def _train_initial_models(self):
        """Train initial models with sample data"""
        # Generate sample training data
        np.random.seed(42)
        n_samples = 10000
        
        sample_data = {
            'transaction_id': [f'txn_{i}' for i in range(n_samples)],
            'amount': np.random.lognormal(mean=5, sigma=2, size=n_samples),
            'currency': np.random.choice(['KES', 'USD', 'EUR'], size=n_samples),
            'transaction_type': np.random.choice(['cash_in', 'cash_out', 'transfer', 'bill_payment'], size=n_samples),
            'timestamp': pd.date_range('2024-01-01', periods=n_samples, freq='1H'),
            'agent_id': np.random.choice([f'agent_{i}' for i in range(100)], size=n_samples),
            'customer_id': np.random.choice([f'customer_{i}' for i in range(1000)], size=n_samples),
            'is_fraud': np.random.choice([0, 1], size=n_samples, p=[0.95, 0.05])
        }
        
        df = pd.DataFrame(sample_data)
        fraud_detector.train_all_models(df, df['is_fraud'])
        fraud_detector.save_models(app.config['MODEL_PATH'])
    
    def predict_fraud(self, transaction_data: Dict[str, Any]) -> FraudPrediction:
        """Predict fraud for a single transaction"""
        start_time = time.time()
        
        try:
            # Create transaction features
            features = self._create_transaction_features(transaction_data)
            
            # Check cache first
            cache_key = self._generate_cache_key(features)
            if cache_key in self.prediction_cache:
                cached_result = self.prediction_cache[cache_key]
                if datetime.now() - cached_result['timestamp'] < timedelta(seconds=self.cache_ttl):
                    logger.info(f"Returning cached prediction for transaction {features.transaction_id}")
                    return cached_result['prediction']
            
            # Make prediction
            prediction = self.detector.predict_fraud(features)
            
            # Cache result
            self.prediction_cache[cache_key] = {
                'prediction': prediction,
                'timestamp': datetime.now()
            }
            
            # Update metrics
            self._update_metrics(prediction, time.time() - start_time)
            
            # Store prediction in Redis if available
            if redis_client:
                self._store_prediction_redis(prediction)
            
            return prediction
            
        except Exception as e:
            logger.error(f"Error in fraud prediction: {e}")
            raise
    
    def batch_predict_fraud(self, transactions: List[Dict[str, Any]]) -> List[FraudPrediction]:
        """Predict fraud for multiple transactions"""
        predictions = []
        
        for transaction_data in transactions:
            try:
                prediction = self.predict_fraud(transaction_data)
                predictions.append(prediction)
            except Exception as e:
                logger.error(f"Error predicting fraud for transaction {transaction_data.get('transaction_id', 'unknown')}: {e}")
                # Create error prediction
                error_prediction = FraudPrediction(
                    transaction_id=transaction_data.get('transaction_id', 'unknown'),
                    fraud_probability=0.0,
                    risk_level=RiskLevel.LOW,
                    fraud_types=[],
                    confidence_score=0.0,
                    rule_triggers=[],
                    ml_features={},
                    gnn_features={},
                    explanation=f"Error in prediction: {str(e)}",
                    recommended_action="MANUAL_REVIEW",
                    timestamp=datetime.now()
                )
                predictions.append(error_prediction)
        
        return predictions
    
    def _create_transaction_features(self, data: Dict[str, Any]) -> TransactionFeatures:
        """Create TransactionFeatures from input data"""
        # Parse timestamp
        timestamp_str = data.get('timestamp')
        if isinstance(timestamp_str, str):
            timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
        else:
            timestamp = datetime.now()
        
        # Parse location
        location = data.get('location', [0.0, 0.0])
        if isinstance(location, list) and len(location) >= 2:
            location_tuple = (float(location[0]), float(location[1]))
        else:
            location_tuple = (0.0, 0.0)
        
        # Create features with defaults
        features = TransactionFeatures(
            transaction_id=data.get('transaction_id', ''),
            amount=float(data.get('amount', 0.0)),
            currency=data.get('currency', 'KES'),
            transaction_type=data.get('transaction_type', 'unknown'),
            timestamp=timestamp,
            agent_id=data.get('agent_id', ''),
            customer_id=data.get('customer_id', ''),
            location=location_tuple,
            device_fingerprint=data.get('device_fingerprint', ''),
            ip_address=data.get('ip_address', ''),
            user_agent=data.get('user_agent', ''),
            velocity_features=data.get('velocity_features', {}),
            behavioral_features=data.get('behavioral_features', {}),
            network_features=data.get('network_features', {}),
            historical_features=data.get('historical_features', {})
        )
        
        return features
    
    def _generate_cache_key(self, features: TransactionFeatures) -> str:
        """Generate cache key for transaction features"""
        key_data = {
            'amount': features.amount,
            'currency': features.currency,
            'type': features.transaction_type,
            'agent_id': features.agent_id,
            'customer_id': features.customer_id,
            'hour': features.timestamp.hour,
            'day': features.timestamp.day
        }
        return f"fraud_prediction:{hash(str(sorted(key_data.items())))}"
    
    def _update_metrics(self, prediction: FraudPrediction, response_time: float):
        """Update service metrics"""
        self.model_metrics['total_predictions'] += 1
        
        if prediction.fraud_probability > 0.5:
            self.model_metrics['fraud_detected'] += 1
        
        # Update average response time
        current_avg = self.model_metrics['avg_response_time']
        total_predictions = self.model_metrics['total_predictions']
        self.model_metrics['avg_response_time'] = (
            (current_avg * (total_predictions - 1) + response_time) / total_predictions
        )
        
        self.model_metrics['last_updated'] = datetime.now()
    
    def _store_prediction_redis(self, prediction: FraudPrediction):
        """Store prediction in Redis for analytics"""
        try:
            key = f"prediction:{prediction.transaction_id}"
            value = json.dumps(asdict(prediction), default=str)
            redis_client.setex(key, 86400, value)  # Store for 24 hours
        except Exception as e:
            logger.error(f"Failed to store prediction in Redis: {e}")
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get service metrics"""
        return self.model_metrics.copy()
    
    def update_feedback(self, transaction_id: str, actual_fraud: bool, feedback_type: str = 'manual'):
        """Update model with feedback"""
        try:
            # Store feedback for model retraining
            feedback_data = {
                'transaction_id': transaction_id,
                'actual_fraud': actual_fraud,
                'feedback_type': feedback_type,
                'timestamp': datetime.now().isoformat()
            }
            
            if redis_client:
                key = f"feedback:{transaction_id}"
                redis_client.setex(key, 86400 * 7, json.dumps(feedback_data))  # Store for 7 days
            
            # Update metrics
            if feedback_type == 'manual':
                prediction_key = f"prediction:{transaction_id}"
                if redis_client and redis_client.exists(prediction_key):
                    prediction_data = json.loads(redis_client.get(prediction_key))
                    predicted_fraud = prediction_data.get('fraud_probability', 0) > 0.5
                    
                    if predicted_fraud and not actual_fraud:
                        self.model_metrics['false_positives'] += 1
                    elif not predicted_fraud and actual_fraud:
                        self.model_metrics['false_negatives'] += 1
            
            logger.info(f"Updated feedback for transaction {transaction_id}")
            
        except Exception as e:
            logger.error(f"Failed to update feedback: {e}")

# Initialize service
fraud_service = FraudDetectionService()

@app.before_first_request
def initialize_service():
    """Initialize the fraud detection service"""
    success = fraud_service.initialize_detector()
    if not success:
        logger.error("Failed to initialize fraud detection service")

@app.before_request
def before_request():
    """Set up request context"""
    g.start_time = time.time()
    g.request_id = request.headers.get('X-Request-ID', f"req_{int(time.time() * 1000)}")

@app.after_request
def after_request(response):
    """Log request completion"""
    duration = time.time() - g.start_time
    logger.info(f"Request {g.request_id} completed in {duration:.3f}s with status {response.status_code}")
    return response

@app.errorhandler(Exception)
def handle_exception(e):
    """Global exception handler"""
    logger.error(f"Unhandled exception in request {g.request_id}: {e}")
    logger.error(traceback.format_exc())
    
    return jsonify({
        'error': 'Internal server error',
        'message': str(e),
        'request_id': g.request_id,
        'timestamp': datetime.now().isoformat()
    }), 500

# API Routes

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'fraud-detection-api',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'models_loaded': fraud_detector is not None,
        'redis_connected': redis_client is not None
    })

@app.route('/api/v1/predict', methods=['POST'])
@limiter.limit("100 per minute")
def predict_fraud():
    """Predict fraud for a single transaction"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'JSON data required'
            }), 400
        
        # Validate required fields
        required_fields = ['transaction_id', 'amount', 'agent_id', 'customer_id']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            return jsonify({
                'error': 'Missing required fields',
                'missing_fields': missing_fields
            }), 400
        
        # Make prediction
        prediction = fraud_service.predict_fraud(data)
        
        # Convert to JSON-serializable format
        result = {
            'transaction_id': prediction.transaction_id,
            'fraud_probability': prediction.fraud_probability,
            'risk_level': prediction.risk_level.value,
            'fraud_types': [ft.value for ft in prediction.fraud_types],
            'confidence_score': prediction.confidence_score,
            'rule_triggers': prediction.rule_triggers,
            'explanation': prediction.explanation,
            'recommended_action': prediction.recommended_action,
            'timestamp': prediction.timestamp.isoformat(),
            'request_id': g.request_id
        }
        
        return jsonify({
            'success': True,
            'data': result,
            'processing_time': time.time() - g.start_time
        })
        
    except Exception as e:
        logger.error(f"Error in fraud prediction: {e}")
        return jsonify({
            'error': 'Prediction failed',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/predict/batch', methods=['POST'])
@limiter.limit("10 per minute")
def predict_fraud_batch():
    """Predict fraud for multiple transactions"""
    try:
        data = request.get_json()
        
        if not data or 'transactions' not in data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'transactions array required'
            }), 400
        
        transactions = data['transactions']
        
        if not isinstance(transactions, list):
            return jsonify({
                'error': 'Invalid request',
                'message': 'transactions must be an array'
            }), 400
        
        if len(transactions) > app.config['BATCH_SIZE']:
            return jsonify({
                'error': 'Batch too large',
                'message': f'Maximum {app.config["BATCH_SIZE"]} transactions per batch'
            }), 400
        
        # Make predictions
        predictions = fraud_service.batch_predict_fraud(transactions)
        
        # Convert to JSON-serializable format
        results = []
        for prediction in predictions:
            result = {
                'transaction_id': prediction.transaction_id,
                'fraud_probability': prediction.fraud_probability,
                'risk_level': prediction.risk_level.value,
                'fraud_types': [ft.value for ft in prediction.fraud_types],
                'confidence_score': prediction.confidence_score,
                'rule_triggers': prediction.rule_triggers,
                'explanation': prediction.explanation,
                'recommended_action': prediction.recommended_action,
                'timestamp': prediction.timestamp.isoformat()
            }
            results.append(result)
        
        return jsonify({
            'success': True,
            'data': {
                'predictions': results,
                'total_count': len(results),
                'batch_id': f"batch_{int(time.time())}"
            },
            'processing_time': time.time() - g.start_time,
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error in batch fraud prediction: {e}")
        return jsonify({
            'error': 'Batch prediction failed',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/feedback', methods=['POST'])
@limiter.limit("50 per minute")
def submit_feedback():
    """Submit feedback for model improvement"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'JSON data required'
            }), 400
        
        # Validate required fields
        required_fields = ['transaction_id', 'actual_fraud']
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            return jsonify({
                'error': 'Missing required fields',
                'missing_fields': missing_fields
            }), 400
        
        transaction_id = data['transaction_id']
        actual_fraud = bool(data['actual_fraud'])
        feedback_type = data.get('feedback_type', 'manual')
        
        # Update feedback
        fraud_service.update_feedback(transaction_id, actual_fraud, feedback_type)
        
        return jsonify({
            'success': True,
            'message': 'Feedback submitted successfully',
            'transaction_id': transaction_id,
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}")
        return jsonify({
            'error': 'Feedback submission failed',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/metrics', methods=['GET'])
def get_metrics():
    """Get service metrics"""
    try:
        metrics = fraud_service.get_metrics()
        
        # Add additional system metrics
        system_metrics = {
            'uptime': time.time() - app.config.get('START_TIME', time.time()),
            'model_last_updated': last_model_update.isoformat() if last_model_update else None,
            'cache_size': len(fraud_service.prediction_cache),
            'redis_connected': redis_client is not None
        }
        
        return jsonify({
            'success': True,
            'data': {
                'model_metrics': metrics,
                'system_metrics': system_metrics
            },
            'timestamp': datetime.now().isoformat(),
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error getting metrics: {e}")
        return jsonify({
            'error': 'Failed to get metrics',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/rules', methods=['GET'])
def get_fraud_rules():
    """Get current fraud detection rules"""
    try:
        if not fraud_detector:
            return jsonify({
                'error': 'Service not initialized',
                'message': 'Fraud detector not available'
            }), 503
        
        rules_info = {
            'rule_names': list(fraud_detector.rule_engine.rules.keys()),
            'thresholds': fraud_detector.rule_engine.thresholds,
            'ensemble_weights': fraud_detector.ensemble_weights,
            'fraud_threshold': fraud_detector.fraud_threshold
        }
        
        return jsonify({
            'success': True,
            'data': rules_info,
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error getting rules: {e}")
        return jsonify({
            'error': 'Failed to get rules',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/rules', methods=['PUT'])
@limiter.limit("5 per minute")
def update_fraud_rules():
    """Update fraud detection rules (admin only)"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'error': 'Invalid request',
                'message': 'JSON data required'
            }), 400
        
        # Validate admin access (simplified - in production, use proper authentication)
        api_key = request.headers.get('X-API-Key')
        if api_key != os.environ.get('ADMIN_API_KEY'):
            return jsonify({
                'error': 'Unauthorized',
                'message': 'Admin access required'
            }), 401
        
        if not fraud_detector:
            return jsonify({
                'error': 'Service not initialized',
                'message': 'Fraud detector not available'
            }), 503
        
        # Update thresholds if provided
        if 'thresholds' in data:
            fraud_detector.rule_engine.thresholds.update(data['thresholds'])
        
        # Update ensemble weights if provided
        if 'ensemble_weights' in data:
            fraud_detector.ensemble_weights.update(data['ensemble_weights'])
        
        # Update fraud threshold if provided
        if 'fraud_threshold' in data:
            fraud_detector.fraud_threshold = float(data['fraud_threshold'])
        
        # Save updated models
        fraud_detector.save_models(app.config['MODEL_PATH'])
        
        return jsonify({
            'success': True,
            'message': 'Rules updated successfully',
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error updating rules: {e}")
        return jsonify({
            'error': 'Failed to update rules',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/retrain', methods=['POST'])
@limiter.limit("1 per hour")
def retrain_models():
    """Retrain fraud detection models (admin only)"""
    try:
        # Validate admin access
        api_key = request.headers.get('X-API-Key')
        if api_key != os.environ.get('ADMIN_API_KEY'):
            return jsonify({
                'error': 'Unauthorized',
                'message': 'Admin access required'
            }), 401
        
        # This would typically fetch new training data from the database
        # For now, we'll use the existing training approach
        
        def retrain_async():
            try:
                with model_lock:
                    global last_model_update
                    fraud_service._train_initial_models()
                    last_model_update = datetime.now()
                    logger.info("Models retrained successfully")
            except Exception as e:
                logger.error(f"Error retraining models: {e}")
        
        # Start retraining in background
        executor.submit(retrain_async)
        
        return jsonify({
            'success': True,
            'message': 'Model retraining started',
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error starting model retraining: {e}")
        return jsonify({
            'error': 'Failed to start retraining',
            'message': str(e),
            'request_id': g.request_id
        }), 500

@app.route('/api/v1/explain/<transaction_id>', methods=['GET'])
def explain_prediction(transaction_id: str):
    """Get detailed explanation for a prediction"""
    try:
        if not redis_client:
            return jsonify({
                'error': 'Service unavailable',
                'message': 'Redis not available for prediction lookup'
            }), 503
        
        # Get prediction from Redis
        prediction_key = f"prediction:{transaction_id}"
        prediction_data = redis_client.get(prediction_key)
        
        if not prediction_data:
            return jsonify({
                'error': 'Prediction not found',
                'message': f'No prediction found for transaction {transaction_id}'
            }), 404
        
        prediction = json.loads(prediction_data)
        
        # Generate detailed explanation
        explanation = {
            'transaction_id': transaction_id,
            'fraud_probability': prediction.get('fraud_probability', 0),
            'risk_level': prediction.get('risk_level', 'unknown'),
            'rule_analysis': {
                'triggered_rules': prediction.get('rule_triggers', []),
                'rule_explanations': {
                    'velocity_check': 'Transaction frequency or volume exceeds normal patterns',
                    'amount_threshold': 'Transaction amount is unusually high',
                    'location_anomaly': 'Transaction location differs from usual patterns',
                    'device_anomaly': 'New or suspicious device detected',
                    'behavioral_anomaly': 'User behavior differs from historical patterns',
                    'network_anomaly': 'Suspicious network characteristics detected'
                }
            },
            'ml_features': prediction.get('ml_features', {}),
            'confidence_factors': {
                'model_agreement': prediction.get('confidence_score', 0),
                'feature_quality': 'High' if len(prediction.get('ml_features', {})) > 10 else 'Medium',
                'historical_data': 'Available' if prediction.get('historical_features') else 'Limited'
            },
            'recommended_action': prediction.get('recommended_action', 'UNKNOWN'),
            'timestamp': prediction.get('timestamp')
        }
        
        return jsonify({
            'success': True,
            'data': explanation,
            'request_id': g.request_id
        })
        
    except Exception as e:
        logger.error(f"Error explaining prediction: {e}")
        return jsonify({
            'error': 'Failed to explain prediction',
            'message': str(e),
            'request_id': g.request_id
        }), 500

# Background tasks
def cleanup_cache():
    """Clean up expired cache entries"""
    try:
        current_time = datetime.now()
        expired_keys = []
        
        for key, value in fraud_service.prediction_cache.items():
            if current_time - value['timestamp'] > timedelta(seconds=fraud_service.cache_ttl):
                expired_keys.append(key)
        
        for key in expired_keys:
            del fraud_service.prediction_cache[key]
        
        if expired_keys:
            logger.info(f"Cleaned up {len(expired_keys)} expired cache entries")
            
    except Exception as e:
        logger.error(f"Error cleaning up cache: {e}")

def periodic_cleanup():
    """Periodic cleanup task"""
    while True:
        try:
            time.sleep(300)  # Run every 5 minutes
            cleanup_cache()
        except Exception as e:
            logger.error(f"Error in periodic cleanup: {e}")

# Start background tasks
if app.config['ENABLE_ASYNC_PROCESSING']:
    cleanup_thread = threading.Thread(target=periodic_cleanup, daemon=True)
    cleanup_thread.start()

# Set start time for uptime calculation
app.config['START_TIME'] = time.time()

if __name__ == '__main__':
    # Development server
    app.run(
        host='0.0.0.0',
        port=int(os.environ.get('PORT', 5001)),
        debug=os.environ.get('DEBUG', 'false').lower() == 'true'
    )

