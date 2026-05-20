#!/usr/bin/env python3
"""
Advanced Hybrid Fraud Detection Engine
Combines rule-based detection with ML/DL/GNN approaches for comprehensive fraud detection
"""

import asyncio
import json
import logging
import os
import pickle
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
import warnings
warnings.filterwarnings('ignore')

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.data import Data, DataLoader
from torch_geometric.nn import GCNConv, GATConv, SAGEConv, global_mean_pool
import networkx as nx
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score
import xgboost as xgb
import lightgbm as lgb
from redis import Redis
import mlflow
import mlflow.pytorch
import mlflow.sklearn
from flask import Flask, request, jsonify
from flask_cors import CORS
import threading
import queue
import uuid

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class FraudDetectionConfig:
    """Configuration for the fraud detection system"""
    
    def __init__(self):
        # Build Redis URL from components or use full URL - FIXED malformed URL
        redis_host = os.getenv('REDIS_HOST', 'redis.remittance.svc.cluster.local')
        redis_port = os.getenv('REDIS_PORT', '6379')
        self.redis_url = os.getenv('REDIS_URL', f'redis://{redis_host}:{redis_port}')
        
        # Model storage - use S3/RustFS for production persistence
        self.model_path = os.getenv('MODEL_PATH', '/var/lib/fraud-models')
        self.s3_model_bucket = os.getenv('S3_MODEL_BUCKET', 'fraud-detection-models')
        self.s3_endpoint = os.getenv('S3_ENDPOINT', 'http://rustfs.remittance.svc.cluster.local:9000')
        
        self.mlflow_tracking_uri = os.getenv('MLFLOW_TRACKING_URI', 'http://mlflow.remittance.svc.cluster.local:5000')
        self.batch_size = int(os.getenv('BATCH_SIZE', '32'))
        self.learning_rate = float(os.getenv('LEARNING_RATE', '0.001'))
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Rule-based thresholds
        self.amount_threshold = float(os.getenv('AMOUNT_THRESHOLD', '10000'))
        self.velocity_threshold = int(os.getenv('VELOCITY_THRESHOLD', '5'))
        self.time_window = int(os.getenv('TIME_WINDOW', '300'))  # 5 minutes
        
        # Model parameters
        self.gnn_hidden_dim = int(os.getenv('GNN_HIDDEN_DIM', '64'))
        self.gnn_num_layers = int(os.getenv('GNN_NUM_LAYERS', '3'))
        self.dropout_rate = float(os.getenv('DROPOUT_RATE', '0.2'))

class RuleBasedDetector:
    """Rule-based fraud detection component"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        self.redis_client = Redis.from_url(config.redis_url)
        
    def check_amount_rules(self, transaction: Dict) -> Tuple[bool, str, float]:
        """Check amount-based rules"""
        amount = float(transaction.get('amount', 0))
        
        # High amount rule
        if amount > self.config.amount_threshold:
            return True, f"High amount transaction: {amount}", 0.8
            
        # Unusual amount patterns
        user_id = transaction.get('user_id')
        if user_id:
            avg_amount = self._get_user_average_amount(user_id)
            if avg_amount > 0 and amount > avg_amount * 5:
                return True, f"Amount 5x higher than average: {amount} vs {avg_amount}", 0.7
                
        return False, "", 0.0
    
    def check_velocity_rules(self, transaction: Dict) -> Tuple[bool, str, float]:
        """Check velocity-based rules"""
        user_id = transaction.get('user_id')
        if not user_id:
            return False, "", 0.0
            
        # Count transactions in time window
        current_time = time.time()
        key = f"velocity:{user_id}"
        
        # Get recent transactions
        recent_txns = self.redis_client.zrangebyscore(
            key, current_time - self.config.time_window, current_time
        )
        
        if len(recent_txns) >= self.config.velocity_threshold:
            return True, f"High velocity: {len(recent_txns)} transactions in {self.config.time_window}s", 0.9
            
        # Add current transaction
        self.redis_client.zadd(key, {str(uuid.uuid4()): current_time})
        self.redis_client.expire(key, self.config.time_window)
        
        return False, "", 0.0
    
    def check_location_rules(self, transaction: Dict) -> Tuple[bool, str, float]:
        """Check location-based rules"""
        user_id = transaction.get('user_id')
        current_location = transaction.get('location', {})
        
        if not user_id or not current_location:
            return False, "", 0.0
            
        # Get user's typical locations
        typical_locations = self._get_user_locations(user_id)
        
        if typical_locations:
            # Check if current location is far from typical locations
            min_distance = min([
                self._calculate_distance(current_location, loc) 
                for loc in typical_locations
            ])
            
            if min_distance > 1000:  # 1000 km
                return True, f"Unusual location: {min_distance}km from typical locations", 0.6
                
        return False, "", 0.0
    
    def check_time_rules(self, transaction: Dict) -> Tuple[bool, str, float]:
        """Check time-based rules"""
        timestamp = transaction.get('timestamp', time.time())
        hour = datetime.fromtimestamp(timestamp).hour
        
        # Unusual hours (2 AM - 5 AM)
        if 2 <= hour <= 5:
            return True, f"Transaction at unusual hour: {hour}:00", 0.4
            
        return False, "", 0.0
    
    def check_merchant_rules(self, transaction: Dict) -> Tuple[bool, str, float]:
        """Check merchant-based rules"""
        merchant_id = transaction.get('merchant_id')
        if not merchant_id:
            return False, "", 0.0
            
        # Check if merchant is blacklisted
        if self.redis_client.sismember('blacklisted_merchants', merchant_id):
            return True, f"Blacklisted merchant: {merchant_id}", 1.0
            
        # Check merchant risk score
        risk_score = self.redis_client.get(f"merchant_risk:{merchant_id}")
        if risk_score and float(risk_score) > 0.8:
            return True, f"High-risk merchant: {merchant_id} (score: {risk_score})", 0.7
            
        return False, "", 0.0
    
    def evaluate_rules(self, transaction: Dict) -> Dict:
        """Evaluate all rules for a transaction"""
        results = {
            'is_fraud': False,
            'confidence': 0.0,
            'triggered_rules': [],
            'rule_scores': {}
        }
        
        # Check all rule categories
        rule_checks = [
            ('amount', self.check_amount_rules),
            ('velocity', self.check_velocity_rules),
            ('location', self.check_location_rules),
            ('time', self.check_time_rules),
            ('merchant', self.check_merchant_rules)
        ]
        
        max_confidence = 0.0
        for rule_name, rule_func in rule_checks:
            is_triggered, reason, confidence = rule_func(transaction)
            results['rule_scores'][rule_name] = confidence
            
            if is_triggered:
                results['triggered_rules'].append({
                    'rule': rule_name,
                    'reason': reason,
                    'confidence': confidence
                })
                max_confidence = max(max_confidence, confidence)
        
        results['is_fraud'] = len(results['triggered_rules']) > 0
        results['confidence'] = max_confidence
        
        return results
    
    def _get_user_average_amount(self, user_id: str) -> float:
        """Get user's average transaction amount"""
        key = f"user_avg_amount:{user_id}"
        avg_amount = self.redis_client.get(key)
        return float(avg_amount) if avg_amount else 0.0
    
    def _get_user_locations(self, user_id: str) -> List[Dict]:
        """Get user's typical locations"""
        key = f"user_locations:{user_id}"
        locations_data = self.redis_client.get(key)
        if locations_data:
            return json.loads(locations_data)
        return []
    
    def _calculate_distance(self, loc1: Dict, loc2: Dict) -> float:
        """Calculate distance between two locations (simplified)"""
        lat1, lon1 = loc1.get('lat', 0), loc1.get('lon', 0)
        lat2, lon2 = loc2.get('lat', 0), loc2.get('lon', 0)
        
        # Simplified distance calculation (Haversine formula would be more accurate)
        return ((lat1 - lat2) ** 2 + (lon1 - lon2) ** 2) ** 0.5 * 111  # Rough km conversion

class GraphNeuralNetwork(nn.Module):
    """Graph Neural Network for fraud detection"""
    
    def __init__(self, input_dim: int, hidden_dim: int, output_dim: int, num_layers: int, dropout: float = 0.2):
        super(GraphNeuralNetwork, self).__init__()
        
        self.num_layers = num_layers
        self.dropout = dropout
        
        # Graph convolution layers
        self.convs = nn.ModuleList()
        self.convs.append(GCNConv(input_dim, hidden_dim))
        
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_dim, hidden_dim))
            
        self.convs.append(GCNConv(hidden_dim, hidden_dim))
        
        # Attention mechanism
        self.attention = GATConv(hidden_dim, hidden_dim, heads=4, concat=False)
        
        # Classification head
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, output_dim)
        )
        
    def forward(self, x, edge_index, batch=None):
        # Graph convolutions with residual connections
        h = x
        for i, conv in enumerate(self.convs):
            h_new = F.relu(conv(h, edge_index))
            h_new = F.dropout(h_new, p=self.dropout, training=self.training)
            
            # Residual connection (if dimensions match)
            if h.size(-1) == h_new.size(-1):
                h = h + h_new
            else:
                h = h_new
        
        # Attention mechanism
        h = self.attention(h, edge_index)
        h = F.dropout(h, p=self.dropout, training=self.training)
        
        # Global pooling for graph-level prediction
        if batch is not None:
            h = global_mean_pool(h, batch)
        else:
            h = torch.mean(h, dim=0, keepdim=True)
        
        # Classification
        output = self.classifier(h)
        return output

class DeepLearningDetector(nn.Module):
    """Deep learning component for fraud detection"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int], dropout: float = 0.2):
        super(DeepLearningDetector, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(dropout)
            ])
            prev_dim = hidden_dim
        
        # Output layer
        layers.append(nn.Linear(prev_dim, 1))
        layers.append(nn.Sigmoid())
        
        self.network = nn.Sequential(*layers)
        
    def forward(self, x):
        return self.network(x)

class MLDetector:
    """Traditional machine learning detector"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        self.models = {}
        self.scalers = {}
        self.feature_columns = []
        
    def train_models(self, X_train: pd.DataFrame, y_train: pd.Series):
        """Train multiple ML models"""
        
        # Prepare data
        self.feature_columns = X_train.columns.tolist()
        
        # Scale features
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        self.scalers['standard'] = scaler
        
        # Train Random Forest
        rf_model = RandomForestClassifier(
            n_estimators=100,
            max_depth=10,
            random_state=42,
            n_jobs=-1
        )
        rf_model.fit(X_train_scaled, y_train)
        self.models['random_forest'] = rf_model
        
        # Train XGBoost
        xgb_model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42
        )
        xgb_model.fit(X_train_scaled, y_train)
        self.models['xgboost'] = xgb_model
        
        # Train LightGBM
        lgb_model = lgb.LGBMClassifier(
            n_estimators=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42
        )
        lgb_model.fit(X_train_scaled, y_train)
        self.models['lightgbm'] = lgb_model
        
        # Train Isolation Forest for anomaly detection
        iso_forest = IsolationForest(
            contamination=0.1,
            random_state=42
        )
        iso_forest.fit(X_train_scaled)
        self.models['isolation_forest'] = iso_forest
        
    def predict(self, X: pd.DataFrame) -> Dict:
        """Make predictions using ensemble of models"""
        
        # Scale features
        X_scaled = self.scalers['standard'].transform(X[self.feature_columns])
        
        predictions = {}
        probabilities = {}
        
        # Get predictions from each model
        for model_name, model in self.models.items():
            if model_name == 'isolation_forest':
                # Isolation forest returns -1 for outliers, 1 for inliers
                pred = model.predict(X_scaled)
                predictions[model_name] = (pred == -1).astype(int)
                # Convert to probability-like score
                scores = model.decision_function(X_scaled)
                probabilities[model_name] = 1 / (1 + np.exp(scores))  # Sigmoid transformation
            else:
                predictions[model_name] = model.predict(X_scaled)
                if hasattr(model, 'predict_proba'):
                    probabilities[model_name] = model.predict_proba(X_scaled)[:, 1]
                else:
                    probabilities[model_name] = predictions[model_name]
        
        # Ensemble prediction (weighted average)
        weights = {
            'random_forest': 0.3,
            'xgboost': 0.3,
            'lightgbm': 0.3,
            'isolation_forest': 0.1
        }
        
        ensemble_prob = sum(
            weights[name] * probabilities[name] 
            for name in probabilities.keys()
        )
        ensemble_pred = (ensemble_prob > 0.5).astype(int)
        
        return {
            'predictions': predictions,
            'probabilities': probabilities,
            'ensemble_prediction': ensemble_pred,
            'ensemble_probability': ensemble_prob
        }

class HybridFraudDetector:
    """Main hybrid fraud detection system"""
    
    def __init__(self, config: FraudDetectionConfig):
        self.config = config
        self.rule_detector = RuleBasedDetector(config)
        self.ml_detector = MLDetector(config)
        self.gnn_model = None
        self.dl_model = None
        self.device = config.device
        
        # Initialize MLflow
        mlflow.set_tracking_uri(config.mlflow_tracking_uri)
        
    def build_transaction_graph(self, transactions: pd.DataFrame) -> Data:
        """Build graph from transaction data"""
        
        # Create nodes (users, merchants, accounts)
        users = transactions['user_id'].unique()
        merchants = transactions['merchant_id'].unique()
        
        # Node mapping
        node_mapping = {}
        node_features = []
        node_types = []
        
        # Add user nodes
        for i, user in enumerate(users):
            node_mapping[f"user_{user}"] = i
            # User features (transaction history, demographics, etc.)
            user_features = self._get_user_features(user, transactions)
            node_features.append(user_features)
            node_types.append(0)  # User type
        
        # Add merchant nodes
        for i, merchant in enumerate(merchants):
            node_mapping[f"merchant_{merchant}"] = len(users) + i
            # Merchant features
            merchant_features = self._get_merchant_features(merchant, transactions)
            node_features.append(merchant_features)
            node_types.append(1)  # Merchant type
        
        # Create edges (transactions)
        edge_index = []
        edge_features = []
        
        for _, txn in transactions.iterrows():
            user_node = node_mapping[f"user_{txn['user_id']}"]
            merchant_node = node_mapping[f"merchant_{txn['merchant_id']}"]
            
            # Add edge from user to merchant
            edge_index.append([user_node, merchant_node])
            edge_features.append([
                txn['amount'],
                txn.get('timestamp', 0),
                txn.get('is_fraud', 0)
            ])
        
        # Convert to tensors
        x = torch.tensor(node_features, dtype=torch.float)
        edge_index = torch.tensor(edge_index, dtype=torch.long).t().contiguous()
        edge_attr = torch.tensor(edge_features, dtype=torch.float)
        
        # Graph-level label (fraud if any transaction is fraud)
        y = torch.tensor([transactions['is_fraud'].any()], dtype=torch.long)
        
        return Data(x=x, edge_index=edge_index, edge_attr=edge_attr, y=y)
    
    def train_gnn_model(self, graph_data: List[Data]):
        """Train Graph Neural Network"""
        
        # Initialize model
        input_dim = graph_data[0].x.size(1)
        self.gnn_model = GraphNeuralNetwork(
            input_dim=input_dim,
            hidden_dim=self.config.gnn_hidden_dim,
            output_dim=2,  # Binary classification
            num_layers=self.config.gnn_num_layers,
            dropout=self.config.dropout_rate
        ).to(self.device)
        
        # Data loader
        loader = DataLoader(graph_data, batch_size=self.config.batch_size, shuffle=True)
        
        # Optimizer and loss
        optimizer = torch.optim.Adam(self.gnn_model.parameters(), lr=self.config.learning_rate)
        criterion = nn.CrossEntropyLoss()
        
        # Training loop
        self.gnn_model.train()
        for epoch in range(100):  # Number of epochs
            total_loss = 0
            for batch in loader:
                batch = batch.to(self.device)
                optimizer.zero_grad()
                
                out = self.gnn_model(batch.x, batch.edge_index, batch.batch)
                loss = criterion(out, batch.y)
                
                loss.backward()
                optimizer.step()
                total_loss += loss.item()
            
            if epoch % 10 == 0:
                logger.info(f"GNN Epoch {epoch}, Loss: {total_loss/len(loader):.4f}")
    
    def train_dl_model(self, X_train: torch.Tensor, y_train: torch.Tensor):
        """Train Deep Learning model"""
        
        input_dim = X_train.size(1)
        hidden_dims = [128, 64, 32]
        
        self.dl_model = DeepLearningDetector(
            input_dim=input_dim,
            hidden_dims=hidden_dims,
            dropout=self.config.dropout_rate
        ).to(self.device)
        
        # Training setup
        optimizer = torch.optim.Adam(self.dl_model.parameters(), lr=self.config.learning_rate)
        criterion = nn.BCELoss()
        
        # Training loop
        self.dl_model.train()
        for epoch in range(100):
            optimizer.zero_grad()
            
            outputs = self.dl_model(X_train)
            loss = criterion(outputs.squeeze(), y_train.float())
            
            loss.backward()
            optimizer.step()
            
            if epoch % 10 == 0:
                logger.info(f"DL Epoch {epoch}, Loss: {loss.item():.4f}")
    
    def predict_fraud(self, transaction: Dict) -> Dict:
        """Main fraud prediction method"""
        
        start_time = time.time()
        
        # 1. Rule-based detection
        rule_results = self.rule_detector.evaluate_rules(transaction)
        
        # 2. Prepare features for ML/DL
        features = self._extract_features(transaction)
        
        # 3. ML predictions
        ml_results = {}
        if hasattr(self.ml_detector, 'models') and self.ml_detector.models:
            feature_df = pd.DataFrame([features])
            ml_results = self.ml_detector.predict(feature_df)
        
        # 4. Deep Learning prediction
        dl_results = {}
        if self.dl_model is not None:
            feature_tensor = torch.tensor([list(features.values())], dtype=torch.float).to(self.device)
            self.dl_model.eval()
            with torch.no_grad():
                dl_prob = self.dl_model(feature_tensor).cpu().numpy()[0][0]
                dl_results = {
                    'probability': float(dl_prob),
                    'prediction': int(dl_prob > 0.5)
                }
        
        # 5. GNN prediction (requires graph context)
        gnn_results = {}
        # Note: GNN requires building a graph with multiple transactions
        # This would be implemented for batch processing
        
        # 6. Ensemble decision
        final_decision = self._make_ensemble_decision(
            rule_results, ml_results, dl_results, gnn_results
        )
        
        processing_time = time.time() - start_time
        
        return {
            'transaction_id': transaction.get('id', 'unknown'),
            'is_fraud': final_decision['is_fraud'],
            'confidence': final_decision['confidence'],
            'risk_score': final_decision['risk_score'],
            'components': {
                'rules': rule_results,
                'ml': ml_results,
                'deep_learning': dl_results,
                'gnn': gnn_results
            },
            'processing_time_ms': processing_time * 1000,
            'timestamp': datetime.now().isoformat()
        }
    
    def _extract_features(self, transaction: Dict) -> Dict:
        """Extract features from transaction"""
        
        features = {
            'amount': float(transaction.get('amount', 0)),
            'hour': datetime.fromtimestamp(transaction.get('timestamp', time.time())).hour,
            'day_of_week': datetime.fromtimestamp(transaction.get('timestamp', time.time())).weekday(),
            'merchant_category': hash(transaction.get('merchant_category', '')) % 1000,
            'payment_method': hash(transaction.get('payment_method', '')) % 100,
            'is_weekend': datetime.fromtimestamp(transaction.get('timestamp', time.time())).weekday() >= 5,
            'amount_log': np.log1p(float(transaction.get('amount', 0))),
        }
        
        # Add location features if available
        location = transaction.get('location', {})
        if location:
            features['latitude'] = float(location.get('lat', 0))
            features['longitude'] = float(location.get('lon', 0))
        else:
            features['latitude'] = 0.0
            features['longitude'] = 0.0
        
        return features
    
    def _get_user_features(self, user_id: str, transactions: pd.DataFrame) -> List[float]:
        """Get user-specific features for GNN"""
        user_txns = transactions[transactions['user_id'] == user_id]
        
        features = [
            len(user_txns),  # Transaction count
            user_txns['amount'].mean(),  # Average amount
            user_txns['amount'].std(),   # Amount std
            user_txns['is_fraud'].mean() if 'is_fraud' in user_txns.columns else 0,  # Fraud rate
        ]
        
        # Pad to fixed size
        while len(features) < 10:
            features.append(0.0)
            
        return features[:10]
    
    def _get_merchant_features(self, merchant_id: str, transactions: pd.DataFrame) -> List[float]:
        """Get merchant-specific features for GNN"""
        merchant_txns = transactions[transactions['merchant_id'] == merchant_id]
        
        features = [
            len(merchant_txns),  # Transaction count
            merchant_txns['amount'].mean(),  # Average amount
            merchant_txns['amount'].std(),   # Amount std
            merchant_txns['is_fraud'].mean() if 'is_fraud' in merchant_txns.columns else 0,  # Fraud rate
        ]
        
        # Pad to fixed size
        while len(features) < 10:
            features.append(0.0)
            
        return features[:10]
    
    def _make_ensemble_decision(self, rule_results: Dict, ml_results: Dict, 
                              dl_results: Dict, gnn_results: Dict) -> Dict:
        """Make final ensemble decision"""
        
        # Component weights
        weights = {
            'rules': 0.3,
            'ml': 0.3,
            'dl': 0.2,
            'gnn': 0.2
        }
        
        # Collect scores
        scores = []
        
        # Rule-based score
        if rule_results.get('is_fraud', False):
            scores.append(weights['rules'] * rule_results.get('confidence', 0))
        
        # ML score
        if ml_results and 'ensemble_probability' in ml_results:
            ml_prob = ml_results['ensemble_probability']
            if isinstance(ml_prob, np.ndarray):
                ml_prob = ml_prob[0] if len(ml_prob) > 0 else 0
            scores.append(weights['ml'] * float(ml_prob))
        
        # DL score
        if dl_results and 'probability' in dl_results:
            scores.append(weights['dl'] * dl_results['probability'])
        
        # GNN score (placeholder)
        if gnn_results and 'probability' in gnn_results:
            scores.append(weights['gnn'] * gnn_results['probability'])
        
        # Calculate final score
        final_score = sum(scores) if scores else 0.0
        
        # Decision threshold
        threshold = 0.5
        is_fraud = final_score > threshold
        
        # Confidence based on score distance from threshold
        confidence = abs(final_score - threshold) * 2  # Scale to 0-1
        confidence = min(confidence, 1.0)
        
        return {
            'is_fraud': is_fraud,
            'risk_score': final_score,
            'confidence': confidence,
            'component_scores': scores
        }

class FraudDetectionAPI:
    """Flask API for fraud detection service"""
    
    def __init__(self, detector: HybridFraudDetector):
        self.detector = detector
        self.app = Flask(__name__)
        CORS(self.app)
        self.setup_routes()
        
    def setup_routes(self):
        """Setup API routes"""
        
        @self.app.route('/health', methods=['GET'])
        def health_check():
            return jsonify({
                'status': 'healthy',
                'timestamp': datetime.now().isoformat(),
                'service': 'advanced-fraud-detection'
            })
        
        @self.app.route('/api/v1/detect', methods=['POST'])
        def detect_fraud():
            try:
                transaction = request.json
                if not transaction:
                    return jsonify({'error': 'No transaction data provided'}), 400
                
                result = self.detector.predict_fraud(transaction)
                return jsonify(result)
                
            except Exception as e:
                logger.error(f"Error in fraud detection: {str(e)}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/batch_detect', methods=['POST'])
        def batch_detect_fraud():
            try:
                transactions = request.json.get('transactions', [])
                if not transactions:
                    return jsonify({'error': 'No transactions provided'}), 400
                
                results = []
                for txn in transactions:
                    result = self.detector.predict_fraud(txn)
                    results.append(result)
                
                return jsonify({'results': results})
                
            except Exception as e:
                logger.error(f"Error in batch fraud detection: {str(e)}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/train', methods=['POST'])
        def train_models():
            try:
                # This would typically load training data from a database
                # For now, return a placeholder response
                return jsonify({
                    'message': 'Training initiated',
                    'status': 'success'
                })
                
            except Exception as e:
                logger.error(f"Error in model training: {str(e)}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/v1/model_info', methods=['GET'])
        def model_info():
            return jsonify({
                'models': {
                    'rule_based': 'Active',
                    'ml_ensemble': 'Active' if hasattr(self.detector.ml_detector, 'models') else 'Not trained',
                    'deep_learning': 'Active' if self.detector.dl_model else 'Not trained',
                    'gnn': 'Active' if self.detector.gnn_model else 'Not trained'
                },
                'version': '2.0.0',
                'last_updated': datetime.now().isoformat()
            })
    
    def run(self, host='0.0.0.0', port=5000, debug=False):
        """Run the Flask application"""
        self.app.run(host=host, port=port, debug=debug)

def main():
    """Main function to run the fraud detection service"""
    
    # Initialize configuration
    config = FraudDetectionConfig()
    
    # Initialize fraud detector
    detector = HybridFraudDetector(config)
    
    # Generate sample training data (in production, load from database)
    logger.info("Generating sample training data...")
    sample_data = generate_sample_data(1000)
    
    # Train ML models
    logger.info("Training ML models...")
    feature_columns = ['amount', 'hour', 'day_of_week', 'merchant_category', 'payment_method']
    X_train = sample_data[feature_columns]
    y_train = sample_data['is_fraud']
    
    detector.ml_detector.train_models(X_train, y_train)
    
    # Train DL model
    logger.info("Training Deep Learning model...")
    X_tensor = torch.tensor(X_train.values, dtype=torch.float)
    y_tensor = torch.tensor(y_train.values, dtype=torch.long)
    detector.train_dl_model(X_tensor, y_tensor)
    
    # Initialize API
    api = FraudDetectionAPI(detector)
    
    # Start the service
    logger.info("Starting Advanced Fraud Detection Service...")
    api.run(host='0.0.0.0', port=int(os.getenv('PORT', '5001')))

def generate_sample_data(n_samples: int) -> pd.DataFrame:
    """Generate sample transaction data for training"""
    
    np.random.seed(42)
    
    data = {
        'user_id': [f"user_{i%100}" for i in range(n_samples)],
        'merchant_id': [f"merchant_{i%50}" for i in range(n_samples)],
        'amount': np.random.lognormal(3, 1, n_samples),
        'hour': np.random.randint(0, 24, n_samples),
        'day_of_week': np.random.randint(0, 7, n_samples),
        'merchant_category': np.random.randint(0, 20, n_samples),
        'payment_method': np.random.randint(0, 5, n_samples),
        'timestamp': [time.time() - np.random.randint(0, 86400*30) for _ in range(n_samples)]
    }
    
    # Generate fraud labels (5% fraud rate)
    fraud_probability = 0.05
    data['is_fraud'] = np.random.binomial(1, fraud_probability, n_samples)
    
    # Make fraud transactions more extreme
    fraud_mask = data['is_fraud'] == 1
    data['amount'][fraud_mask] *= np.random.uniform(2, 10, sum(fraud_mask))
    
    return pd.DataFrame(data)

if __name__ == '__main__':
    main()

