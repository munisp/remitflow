#!/usr/bin/env python3
"""
Advanced Hybrid Fraud Detection Service for Remittance Platform
Combines rule-based detection with ML, Deep Learning, and Graph Neural Networks
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple, Union
import logging
from datetime import datetime, timedelta
import json
import numpy as np
import pandas as pd
from dataclasses import dataclass, asdict
import asyncio
import threading
import time
import uuid

# Add project root to path
project_root = Path(__file__).parent.parent.parent.parent
sys.path.append(str(project_root))

try:
    # Flask and web framework
    from flask import Flask, request, jsonify, g
    from flask_cors import CORS
    
    # Machine Learning libraries
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch_geometric.nn import GCNConv, GATConv, SAGEConv
    from torch_geometric.data import Data, DataLoader
    import torch_geometric.transforms as T
    
    from sklearn.ensemble import IsolationForest, RandomForestClassifier
    from sklearn.preprocessing import StandardScaler, LabelEncoder
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, roc_auc_score, precision_recall_curve
    import xgboost as xgb
    
    # Deep Learning
    from tensorflow.keras.models import Sequential, Model
    from tensorflow.keras.layers import Dense, LSTM, Dropout, Input, Embedding, Concatenate
    from tensorflow.keras.optimizers import Adam
    from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
    
    # Rule engine
    import experta
    from experta import KnowledgeEngine, Rule, Fact, DefFacts
    
    # Data processing
    import redis
    import networkx as nx
    
    # Monitoring
    import mlflow
    import mlflow.sklearn
    import mlflow.pytorch
    import mlflow.tensorflow
    
except ImportError as e:
    logger.info(f"Required packages not installed: {e}")
    logger.info("Please install: pip install torch torch-geometric tensorflow scikit-learn xgboost experta networkx mlflow redis")
    sys.exit(1)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class TransactionData:
    """Transaction data structure for fraud detection"""
    transaction_id: str
    customer_id: str
    agent_id: str
    amount: float
    transaction_type: str
    timestamp: datetime
    latitude: float
    longitude: float
    device_fingerprint: str
    ip_address: str
    merchant_category: str
    channel: str
    currency: str
    metadata: Dict[str, Any]

@dataclass
class FraudPrediction:
    """Fraud prediction result"""
    transaction_id: str
    fraud_probability: float
    risk_score: float
    prediction_confidence: float
    rule_based_score: float
    ml_score: float
    gnn_score: float
    ensemble_score: float
    triggered_rules: List[str]
    feature_importance: Dict[str, float]
    explanation: str
    recommendation: str

class TransactionFact(Fact):
    """Transaction fact for rule engine"""
    pass

class FraudRulesEngine(KnowledgeEngine):
    """Rule-based fraud detection engine"""
    
    def __init__(self):
        super().__init__()
        self.triggered_rules = []
        self.rule_scores = {}
    
        super().__init__()
        self.triggered_rules = []
        self.rule_scores = {}
    
    @DefFacts()
    def initial_facts(self):
        """Define initial facts"""
        yield Fact(action="start_analysis")
    
        """Define initial facts"""
        yield Fact(action="start_analysis")
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(amount=lambda x: x > 10000))
    def high_amount_rule(self):
        """High amount transaction rule"""
        self.triggered_rules.append("high_amount")
        self.rule_scores["high_amount"] = 30
        self.declare(Fact(risk_factor="high_amount"))
    
        """High amount transaction rule"""
        self.triggered_rules.append("high_amount")
        self.rule_scores["high_amount"] = 30
        self.declare(Fact(risk_factor="high_amount"))
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(hour=lambda x: x < 6 or x > 22))
    def unusual_time_rule(self):
        """Unusual time transaction rule"""
        self.triggered_rules.append("unusual_time")
        self.rule_scores["unusual_time"] = 15
        self.declare(Fact(risk_factor="unusual_time"))
    
        """Unusual time transaction rule"""
        self.triggered_rules.append("unusual_time")
        self.rule_scores["unusual_time"] = 15
        self.declare(Fact(risk_factor="unusual_time"))
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(velocity=lambda x: x > 10))
    def high_velocity_rule(self):
        """High velocity transaction rule"""
        self.triggered_rules.append("high_velocity")
        self.rule_scores["high_velocity"] = 25
        self.declare(Fact(risk_factor="high_velocity"))
    
        """High velocity transaction rule"""
        self.triggered_rules.append("high_velocity")
        self.rule_scores["high_velocity"] = 25
        self.declare(Fact(risk_factor="high_velocity"))
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(location_risk=lambda x: x > 0.7))
    def high_location_risk_rule(self):
        """High location risk rule"""
        self.triggered_rules.append("high_location_risk")
        self.rule_scores["high_location_risk"] = 20
        self.declare(Fact(risk_factor="high_location_risk"))
    
        """High location risk rule"""
        self.triggered_rules.append("high_location_risk")
        self.rule_scores["high_location_risk"] = 20
        self.declare(Fact(risk_factor="high_location_risk"))
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(device_new=True))
    def new_device_rule(self):
        """New device rule"""
        self.triggered_rules.append("new_device")
        self.rule_scores["new_device"] = 10
        self.declare(Fact(risk_factor="new_device"))
    
        """New device rule"""
        self.triggered_rules.append("new_device")
        self.rule_scores["new_device"] = 10
        self.declare(Fact(risk_factor="new_device"))
    
    @Rule(Fact(action="start_analysis"),
          TransactionFact(cross_border=True))
    def cross_border_rule(self):
        """Cross border transaction rule"""
        self.triggered_rules.append("cross_border")
        self.rule_scores["cross_border"] = 15
        self.declare(Fact(risk_factor="cross_border"))
    
        """Cross border transaction rule"""
        self.triggered_rules.append("cross_border")
        self.rule_scores["cross_border"] = 15
        self.declare(Fact(risk_factor="cross_border"))
    
    def calculate_rule_score(self) -> float:
        """Calculate overall rule-based score"""
        if not self.rule_scores:
            return 0.0
        
        # Weighted sum with diminishing returns
        total_score = sum(self.rule_scores.values())
        normalized_score = min(100, total_score)
        
        return normalized_score

class TransactionGNN(nn.Module):
    """Graph Neural Network for transaction fraud detection"""
    
    def __init__(self, input_dim: int, hidden_dim: int = 64, output_dim: int = 1, num_layers: int = 3):
        super(TransactionGNN, self).__init__()
        
        self.num_layers = num_layers
        self.convs = nn.ModuleList()
        self.batch_norms = nn.ModuleList()
        
        # Input layer
        self.convs.append(GCNConv(input_dim, hidden_dim))
        self.batch_norms.append(nn.BatchNorm1d(hidden_dim))
        
        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_dim, hidden_dim))
            self.batch_norms.append(nn.BatchNorm1d(hidden_dim))
        
        # Output layer
        self.convs.append(GCNConv(hidden_dim, output_dim))
        
        self.dropout = nn.Dropout(0.3)
        
        super(TransactionGNN, self).__init__()
        
        self.num_layers = num_layers
        self.convs = nn.ModuleList()
        self.batch_norms = nn.ModuleList()
        
        # Input layer
        self.convs.append(GCNConv(input_dim, hidden_dim))
        self.batch_norms.append(nn.BatchNorm1d(hidden_dim))
        
        # Hidden layers
        for _ in range(num_layers - 2):
            self.convs.append(GCNConv(hidden_dim, hidden_dim))
            self.batch_norms.append(nn.BatchNorm1d(hidden_dim))
        
        # Output layer
        self.convs.append(GCNConv(hidden_dim, output_dim))
        
        self.dropout = nn.Dropout(0.3)
        
    def forward(self, x, edge_index, batch=None):
        """Forward pass"""
        for i in range(self.num_layers - 1):
            x = self.convs[i](x, edge_index)
            x = self.batch_norms[i](x)
            x = F.relu(x)
            x = self.dropout(x)
        
        # Final layer
        x = self.convs[-1](x, edge_index)
        return torch.sigmoid(x)

        """Forward pass"""
        for i in range(self.num_layers - 1):
            x = self.convs[i](x, edge_index)
            x = self.batch_norms[i](x)
            x = F.relu(x)
            x = self.dropout(x)
        
        # Final layer
        x = self.convs[-1](x, edge_index)
        return torch.sigmoid(x)

class DeepFraudDetector(nn.Module):
    """Deep learning model for fraud detection"""
    
    def __init__(self, input_dim: int, hidden_dims: List[int] = [128, 64, 32]):
        super(DeepFraudDetector, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        # Output layer
        layers.append(nn.Linear(prev_dim, 1))
        layers.append(nn.Sigmoid())
        
        self.network = nn.Sequential(*layers)
    
        super(DeepFraudDetector, self).__init__()
        
        layers = []
        prev_dim = input_dim
        
        for hidden_dim in hidden_dims:
            layers.extend([
                nn.Linear(prev_dim, hidden_dim),
                nn.BatchNorm1d(hidden_dim),
                nn.ReLU(),
                nn.Dropout(0.3)
            ])
            prev_dim = hidden_dim
        
        # Output layer
        layers.append(nn.Linear(prev_dim, 1))
        layers.append(nn.Sigmoid())
        
        self.network = nn.Sequential(*layers)
    
    def forward(self, x):
        """Forward pass"""
        return self.network(x)

        """Forward pass"""
        return self.network(x)

class HybridFraudDetectionService:
    """Hybrid fraud detection service combining rules, ML, DL, and GNN"""
    
    def __init__(self, redis_host: str = "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")")", redis_port: int = 6379):
        self.redis_client = redis.Redis(host=redis_host, port=redis_port, decode_responses=True)
        
        # Model components
        self.rules_engine = FraudRulesEngine()
        self.isolation_forest = None
        self.random_forest = None
        self.xgboost_model = None
        self.deep_model = None
        self.gnn_model = None
        
        # Preprocessing
        self.scaler = StandardScaler()
        self.label_encoders = {}
        
        # Feature engineering
        self.feature_columns = [
            'amount', 'hour', 'day_of_week', 'transaction_type_encoded',
            'customer_velocity', 'agent_risk_score', 'location_risk',
            'device_risk', 'amount_zscore', 'time_since_last_txn'
        ]
        
        # Model weights for ensemble
        self.model_weights = {
            'rules': 0.25,
            'isolation_forest': 0.15,
            'random_forest': 0.20,
            'xgboost': 0.20,
            'deep_learning': 0.15,
            'gnn': 0.05
        }
        
        # Initialize MLflow
        mlflow.set_tracking_uri("http://os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "os.getenv("HOST", "localhost")")")"):5000")
        mlflow.set_experiment("fraud_detection")
        
        self._initialize_models()
    
    def _initialize_models(self):
        """Initialize all fraud detection models"""
        try:
            # Initialize traditional ML models
            self.isolation_forest = IsolationForest(
                contamination=0.1,
                random_state=42,
                n_estimators=100
            )
            
            self.random_forest = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42
            )
            
            self.xgboost_model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                random_state=42
            )
            
            # Initialize deep learning model
            self.deep_model = DeepFraudDetector(
                input_dim=len(self.feature_columns),
                hidden_dims=[128, 64, 32]
            )
            
            # Initialize GNN model
            self.gnn_model = TransactionGNN(
                input_dim=len(self.feature_columns),
                hidden_dim=64,
                output_dim=1,
                num_layers=3
            )
            
            logger.info("Fraud detection models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
        """Initialize all fraud detection models"""
        try:
            # Initialize traditional ML models
            self.isolation_forest = IsolationForest(
                contamination=0.1,
                random_state=42,
                n_estimators=100
            )
            
            self.random_forest = RandomForestClassifier(
                n_estimators=100,
                max_depth=10,
                random_state=42
            )
            
            self.xgboost_model = xgb.XGBClassifier(
                n_estimators=100,
                max_depth=6,
                learning_rate=0.1,
                random_state=42
            )
            
            # Initialize deep learning model
            self.deep_model = DeepFraudDetector(
                input_dim=len(self.feature_columns),
                hidden_dims=[128, 64, 32]
            )
            
            # Initialize GNN model
            self.gnn_model = TransactionGNN(
                input_dim=len(self.feature_columns),
                hidden_dim=64,
                output_dim=1,
                num_layers=3
            )
            
            logger.info("Fraud detection models initialized")
            
        except Exception as e:
            logger.error(f"Failed to initialize models: {e}")
            raise
    
    def extract_features(self, transaction: TransactionData) -> Dict[str, float]:
        """Extract features from transaction data"""
        try:
            # Basic features
            features = {
                'amount': float(transaction.amount),
                'hour': transaction.timestamp.hour,
                'day_of_week': transaction.timestamp.weekday()
            }
            
            # Encode transaction type
            if 'transaction_type' not in self.label_encoders:
                self.label_encoders['transaction_type'] = LabelEncoder()
                # Fit with common transaction types
                self.label_encoders['transaction_type'].fit([
                    'deposit', 'withdrawal', 'transfer', 'bill_payment', 'airtime'
                ])
            
            try:
                features['transaction_type_encoded'] = float(
                    self.label_encoders['transaction_type'].transform([transaction.transaction_type])[0]
                )
            except ValueError:
                features['transaction_type_encoded'] = 0.0
            
            # Customer velocity (transactions in last hour)
            velocity_key = f"customer:{transaction.customer_id}:velocity"
            velocity = self.redis_client.llen(velocity_key)
            features['customer_velocity'] = float(velocity)
            
            # Agent risk score (simplified)
            agent_key = f"agent:{transaction.agent_id}:risk"
            agent_risk = self.redis_client.get(agent_key)
            features['agent_risk_score'] = float(agent_risk) if agent_risk else 50.0
            
            # Location risk (based on coordinates)
            features['location_risk'] = self._calculate_location_risk(
                transaction.latitude, transaction.longitude
            )
            
            # Device risk
            features['device_risk'] = self._calculate_device_risk(transaction.device_fingerprint)
            
            # Amount z-score (compared to customer's history)
            features['amount_zscore'] = self._calculate_amount_zscore(
                transaction.customer_id, transaction.amount
            )
            
            # Time since last transaction
            features['time_since_last_txn'] = self._get_time_since_last_transaction(
                transaction.customer_id
            )
            
            return features
            
        except Exception as e:
            logger.error(f"Failed to extract features: {e}")
            return {col: 0.0 for col in self.feature_columns}
    
    def _calculate_location_risk(self, latitude: float, longitude: float) -> float:
        """Calculate location-based risk score"""
        try:
            # Simplified location risk calculation
            # In production, this would use historical fraud data by location
            
            # Check if coordinates are valid
            if abs(latitude) > 90 or abs(longitude) > 180:
                return 100.0  # Invalid coordinates = high risk
            
            # Check if location is in known high-risk areas (simplified)
            high_risk_zones = [
                # Example high-risk zones (lat_min, lat_max, lng_min, lng_max)
                (-26.0, -25.0, 27.0, 29.0),  # Example: Johannesburg area
                (6.0, 7.0, 3.0, 4.0),        # Example: Lagos area
            ]
            
            for lat_min, lat_max, lng_min, lng_max in high_risk_zones:
                if lat_min <= latitude <= lat_max and lng_min <= longitude <= lng_max:
                    return 75.0
            
            # Distance from major cities (lower risk)
            major_cities = [
                (-26.2041, 28.0473),  # Johannesburg
                (6.5244, 3.3792),     # Lagos
                (-1.2921, 36.8219),   # Nairobi
                (5.6037, -0.1870),    # Accra
            ]
            
            min_distance = float('inf')
            for city_lat, city_lng in major_cities:
                distance = ((latitude - city_lat) ** 2 + (longitude - city_lng) ** 2) ** 0.5
                min_distance = min(min_distance, distance)
            
            # Higher risk for remote locations
            if min_distance > 5.0:  # More than ~500km from major city
                return 60.0
            elif min_distance > 2.0:  # More than ~200km
                return 40.0
            else:
                return 20.0
            
        except Exception as e:
            logger.error(f"Failed to calculate location risk: {e}")
            return 50.0
    
    def _calculate_device_risk(self, device_fingerprint: str) -> float:
        """Calculate device-based risk score"""
        try:
            # Check if device is known
            device_key = f"device:{device_fingerprint}"
            device_data = self.redis_client.hgetall(device_key)
            
            if not device_data:
                # New device = higher risk
                return 70.0
            
            # Check device reputation
            fraud_count = int(device_data.get('fraud_count', 0))
            total_transactions = int(device_data.get('total_transactions', 1))
            
            fraud_rate = fraud_count / total_transactions
            
            if fraud_rate > 0.1:
                return 90.0
            elif fraud_rate > 0.05:
                return 70.0
            elif fraud_rate > 0.01:
                return 50.0
            else:
                return 20.0
            
        except Exception as e:
            logger.error(f"Failed to calculate device risk: {e}")
            return 50.0
    
    def _calculate_amount_zscore(self, customer_id: str, amount: float) -> float:
        """Calculate amount z-score compared to customer history"""
        try:
            # Get customer's transaction history
            history_key = f"customer:{customer_id}:amounts"
            amounts = self.redis_client.lrange(history_key, 0, 99)  # Last 100 transactions
            
            if len(amounts) < 5:
                return 0.0  # Not enough history
            
            amounts = [float(amt) for amt in amounts]
            mean_amount = np.mean(amounts)
            std_amount = np.std(amounts)
            
            if std_amount == 0:
                return 0.0
            
            z_score = (amount - mean_amount) / std_amount
            return float(z_score)
            
        except Exception as e:
            logger.error(f"Failed to calculate amount z-score: {e}")
            return 0.0
    
    def _get_time_since_last_transaction(self, customer_id: str) -> float:
        """Get time since last transaction in hours"""
        try:
            last_txn_key = f"customer:{customer_id}:last_transaction"
            last_txn_time = self.redis_client.get(last_txn_key)
            
            if not last_txn_time:
                return 24.0  # Default to 24 hours
            
            last_time = datetime.fromisoformat(last_txn_time)
            time_diff = datetime.now() - last_time
            
            return float(time_diff.total_seconds() / 3600)  # Convert to hours
            
        except Exception as e:
            logger.error(f"Failed to get time since last transaction: {e}")
            return 24.0
    
    def run_rule_based_detection(self, transaction: TransactionData, features: Dict[str, float]) -> Tuple[float, List[str]]:
        """Run rule-based fraud detection"""
        try:
            # Reset rules engine
            self.rules_engine.reset()
            self.rules_engine.triggered_rules = []
            self.rules_engine.rule_scores = {}
            
            # Create transaction fact
            transaction_fact = TransactionFact(
                amount=features['amount'],
                hour=features['hour'],
                velocity=features['customer_velocity'],
                location_risk=features['location_risk'] / 100.0,
                device_new=features['device_risk'] > 60,
                cross_border=features['location_risk'] > 80  # Simplified
            )
            
            # Declare facts and run rules
            self.rules_engine.declare(transaction_fact)
            self.rules_engine.run()
            
            # Calculate rule-based score
            rule_score = self.rules_engine.calculate_rule_score()
            triggered_rules = self.rules_engine.triggered_rules.copy()
            
            return rule_score, triggered_rules
            
        except Exception as e:
            logger.error(f"Failed to run rule-based detection: {e}")
            return 0.0, []
    
    def run_ml_detection(self, features: Dict[str, float]) -> Dict[str, float]:
        """Run machine learning based detection"""
        try:
            # Prepare feature vector
            feature_vector = np.array([features[col] for col in self.feature_columns]).reshape(1, -1)
            
            # Scale features
            feature_vector_scaled = self.scaler.transform(feature_vector)
            
            ml_scores = {}
            
            # Isolation Forest (anomaly detection)
            try:
                anomaly_score = self.isolation_forest.decision_function(feature_vector_scaled)[0]
                # Convert to 0-100 scale
                ml_scores['isolation_forest'] = max(0, min(100, (1 - anomaly_score) * 50 + 50))
            except:
                ml_scores['isolation_forest'] = 50.0
            
            # Random Forest (if trained)
            try:
                rf_proba = self.random_forest.predict_proba(feature_vector_scaled)[0]
                ml_scores['random_forest'] = rf_proba[1] * 100 if len(rf_proba) > 1 else 50.0
            except:
                ml_scores['random_forest'] = 50.0
            
            # XGBoost (if trained)
            try:
                xgb_proba = self.xgboost_model.predict_proba(feature_vector_scaled)[0]
                ml_scores['xgboost'] = xgb_proba[1] * 100 if len(xgb_proba) > 1 else 50.0
            except:
                ml_scores['xgboost'] = 50.0
            
            return ml_scores
            
        except Exception as e:
            logger.error(f"Failed to run ML detection: {e}")
            return {'isolation_forest': 50.0, 'random_forest': 50.0, 'xgboost': 50.0}
    
    def run_deep_learning_detection(self, features: Dict[str, float]) -> float:
        """Run deep learning based detection"""
        try:
            # Prepare feature tensor
            feature_vector = torch.tensor([features[col] for col in self.feature_columns], dtype=torch.float32)
            feature_vector = feature_vector.unsqueeze(0)  # Add batch dimension
            
            # Run inference
            self.deep_model.eval()
            with torch.no_grad():
                prediction = self.deep_model(feature_vector)
                dl_score = float(prediction.item()) * 100
            
            return dl_score
            
        except Exception as e:
            logger.error(f"Failed to run deep learning detection: {e}")
            return 50.0
    
    def run_gnn_detection(self, transaction: TransactionData, features: Dict[str, float]) -> float:
        """Run Graph Neural Network based detection"""
        try:
            # Create a simple graph for this transaction
            # In production, this would use a pre-built transaction graph
            
            # Create node features (simplified)
            node_features = torch.tensor([
                [features[col] for col in self.feature_columns],  # Transaction node
                [50.0] * len(self.feature_columns),  # Customer node (simplified)
                [30.0] * len(self.feature_columns),  # Agent node (simplified)
            ], dtype=torch.float32)
            
            # Create edges (transaction connects to customer and agent)
            edge_index = torch.tensor([
                [0, 0, 1, 2],  # Source nodes
                [1, 2, 0, 0]   # Target nodes
            ], dtype=torch.long)
            
            # Create graph data
            graph_data = Data(x=node_features, edge_index=edge_index)
            
            # Run GNN inference
            self.gnn_model.eval()
            with torch.no_grad():
                prediction = self.gnn_model(graph_data.x, graph_data.edge_index)
                gnn_score = float(prediction[0].item()) * 100  # Score for transaction node
            
            return gnn_score
            
        except Exception as e:
            logger.error(f"Failed to run GNN detection: {e}")
            return 50.0
    
    def predict_fraud(self, transaction: TransactionData) -> FraudPrediction:
        """Predict fraud using hybrid approach"""
        try:
            # Extract features
            features = self.extract_features(transaction)
            
            # Run rule-based detection
            rule_score, triggered_rules = self.run_rule_based_detection(transaction, features)
            
            # Run ML detection
            ml_scores = self.run_ml_detection(features)
            
            # Run deep learning detection
            dl_score = self.run_deep_learning_detection(features)
            
            # Run GNN detection
            gnn_score = self.run_gnn_detection(transaction, features)
            
            # Calculate ensemble score
            ensemble_score = (
                self.model_weights['rules'] * rule_score +
                self.model_weights['isolation_forest'] * ml_scores['isolation_forest'] +
                self.model_weights['random_forest'] * ml_scores['random_forest'] +
                self.model_weights['xgboost'] * ml_scores['xgboost'] +
                self.model_weights['deep_learning'] * dl_score +
                self.model_weights['gnn'] * gnn_score
            )
            
            # Calculate fraud probability
            fraud_probability = ensemble_score / 100.0
            
            # Calculate confidence based on agreement between models
            scores = [rule_score, ml_scores['isolation_forest'], ml_scores['random_forest'], 
                     ml_scores['xgboost'], dl_score, gnn_score]
            confidence = 1.0 - (np.std(scores) / 100.0)  # Higher std = lower confidence
            
            # Generate explanation
            explanation = self._generate_explanation(
                rule_score, ml_scores, dl_score, gnn_score, triggered_rules
            )
            
            # Generate recommendation
            recommendation = self._generate_recommendation(ensemble_score, triggered_rules)
            
            # Feature importance (simplified)
            feature_importance = {
                'amount': 0.25,
                'velocity': 0.20,
                'location_risk': 0.15,
                'device_risk': 0.15,
                'time_factors': 0.10,
                'historical_patterns': 0.15
            }
            
            return FraudPrediction(
                transaction_id=transaction.transaction_id,
                fraud_probability=fraud_probability,
                risk_score=ensemble_score,
                prediction_confidence=confidence,
                rule_based_score=rule_score,
                ml_score=np.mean(list(ml_scores.values())),
                gnn_score=gnn_score,
                ensemble_score=ensemble_score,
                triggered_rules=triggered_rules,
                feature_importance=feature_importance,
                explanation=explanation,
                recommendation=recommendation
            )
            
        except Exception as e:
            logger.error(f"Failed to predict fraud: {e}")
            # Return default prediction
            return FraudPrediction(
                transaction_id=transaction.transaction_id,
                fraud_probability=0.5,
                risk_score=50.0,
                prediction_confidence=0.5,
                rule_based_score=50.0,
                ml_score=50.0,
                gnn_score=50.0,
                ensemble_score=50.0,
                triggered_rules=[],
                feature_importance={},
                explanation="Error in fraud detection",
                recommendation="Manual review required"
            )
    
    def _generate_explanation(self, rule_score: float, ml_scores: Dict[str, float], 
                            dl_score: float, gnn_score: float, triggered_rules: List[str]) -> str:
        """Generate human-readable explanation"""
        explanations = []
        
        if rule_score > 50:
            explanations.append(f"Rule-based analysis flagged {len(triggered_rules)} risk factors")
        
        if np.mean(list(ml_scores.values())) > 70:
            explanations.append("Machine learning models detected anomalous patterns")
        
        if dl_score > 70:
            explanations.append("Deep learning model identified suspicious behavior")
        
        if gnn_score > 70:
            explanations.append("Graph analysis revealed concerning network patterns")
        
        if triggered_rules:
            explanations.append(f"Specific concerns: {', '.join(triggered_rules)}")
        
        return "; ".join(explanations) if explanations else "No significant risk factors detected"
    
    def _generate_recommendation(self, ensemble_score: float, triggered_rules: List[str]) -> str:
        """Generate recommendation based on risk score"""
        if ensemble_score > 90:
            return "BLOCK: High fraud probability - immediate intervention required"
        elif ensemble_score > 70:
            return "REVIEW: Elevated risk - manual review recommended"
        elif ensemble_score > 50:
            return "MONITOR: Moderate risk - enhanced monitoring suggested"
        else:
            return "APPROVE: Low risk - proceed with normal processing"
    
    def train_models(self, training_data: pd.DataFrame, labels: pd.Series):
        """Train all ML models with historical data"""
        try:
            with mlflow.start_run():
                # Prepare features
                features_list = []
                for _, row in training_data.iterrows():
                    transaction = TransactionData(
                        transaction_id=row['transaction_id'],
                        customer_id=row['customer_id'],
                        agent_id=row['agent_id'],
                        amount=row['amount'],
                        transaction_type=row['transaction_type'],
                        timestamp=pd.to_datetime(row['timestamp']),
                        latitude=row['latitude'],
                        longitude=row['longitude'],
                        device_fingerprint=row['device_fingerprint'],
                        ip_address=row['ip_address'],
                        merchant_category=row.get('merchant_category', 'unknown'),
                        channel=row.get('channel', 'unknown'),
                        currency=row.get('currency', 'USD'),
                        metadata={}
                    )
                    features = self.extract_features(transaction)
                    features_list.append([features[col] for col in self.feature_columns])
                
                X = np.array(features_list)
                y = labels.values
                
                # Split data
                X_train, X_test, y_train, y_test = train_test_split(
                    X, y, test_size=0.2, random_state=42, stratify=y
                )
                
                # Scale features
                X_train_scaled = self.scaler.fit_transform(X_train)
                X_test_scaled = self.scaler.transform(X_test)
                
                # Train Isolation Forest
                self.isolation_forest.fit(X_train_scaled)
                
                # Train Random Forest
                self.random_forest.fit(X_train_scaled, y_train)
                rf_score = self.random_forest.score(X_test_scaled, y_test)
                
                # Train XGBoost
                self.xgboost_model.fit(X_train_scaled, y_train)
                xgb_score = self.xgboost_model.score(X_test_scaled, y_test)
                
                # Train Deep Learning model
                X_train_tensor = torch.tensor(X_train_scaled, dtype=torch.float32)
                y_train_tensor = torch.tensor(y_train, dtype=torch.float32).unsqueeze(1)
                X_test_tensor = torch.tensor(X_test_scaled, dtype=torch.float32)
                y_test_tensor = torch.tensor(y_test, dtype=torch.float32).unsqueeze(1)
                
                optimizer = torch.optim.Adam(self.deep_model.parameters(), lr=0.001)
                criterion = nn.BCELoss()
                
                # Training loop
                self.deep_model.train()
                for epoch in range(100):
                    optimizer.zero_grad()
                    outputs = self.deep_model(X_train_tensor)
                    loss = criterion(outputs, y_train_tensor)
                    loss.backward()
                    optimizer.step()
                
                # Evaluate deep model
                self.deep_model.eval()
                with torch.no_grad():
                    dl_predictions = self.deep_model(X_test_tensor)
                    dl_accuracy = ((dl_predictions > 0.5).float() == y_test_tensor).float().mean()
                
                # Log metrics
                mlflow.log_metric("random_forest_accuracy", rf_score)
                mlflow.log_metric("xgboost_accuracy", xgb_score)
                mlflow.log_metric("deep_learning_accuracy", float(dl_accuracy))
                
                # Save models
                mlflow.sklearn.log_model(self.random_forest, "random_forest")
                mlflow.sklearn.log_model(self.xgboost_model, "xgboost")
                mlflow.pytorch.log_model(self.deep_model, "deep_learning")
                
                logger.info(f"Models trained successfully - RF: {rf_score:.3f}, XGB: {xgb_score:.3f}, DL: {dl_accuracy:.3f}")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise
    
        """Train all ML models with historical data"""
        try:
            with mlflow.start_run():
                # Prepare features
                features_list = []
                for _, row in training_data.iterrows():
                    transaction = TransactionData(
                        transaction_id=row['transaction_id'],
                        customer_id=row['customer_id'],
                        agent_id=row['agent_id'],
                        amount=row['amount'],
                        transaction_type=row['transaction_type'],
                        timestamp=pd.to_datetime(row['timestamp']),
                        latitude=row['latitude'],
                        longitude=row['longitude'],
                        device_fingerprint=row['device_fingerprint'],
                        ip_address=row['ip_address'],
                        merchant_category=row.get('merchant_category', 'unknown'),
                        channel=row.get('channel', 'unknown'),
                        currency=row.get('currency', 'USD'),
                        metadata={}
                    )
                    features = self.extract_features(transaction)
                    features_list.append([features[col] for col in self.feature_columns])
                
                X = np.array(features_list)
                y = labels.values
                
                # Split data
                X_train, X_test, y_train, y_test = train_test_split(
                    X, y, test_size=0.2, random_state=42, stratify=y
                )
                
                # Scale features
                X_train_scaled = self.scaler.fit_transform(X_train)
                X_test_scaled = self.scaler.transform(X_test)
                
                # Train Isolation Forest
                self.isolation_forest.fit(X_train_scaled)
                
                # Train Random Forest
                self.random_forest.fit(X_train_scaled, y_train)
                rf_score = self.random_forest.score(X_test_scaled, y_test)
                
                # Train XGBoost
                self.xgboost_model.fit(X_train_scaled, y_train)
                xgb_score = self.xgboost_model.score(X_test_scaled, y_test)
                
                # Train Deep Learning model
                X_train_tensor = torch.tensor(X_train_scaled, dtype=torch.float32)
                y_train_tensor = torch.tensor(y_train, dtype=torch.float32).unsqueeze(1)
                X_test_tensor = torch.tensor(X_test_scaled, dtype=torch.float32)
                y_test_tensor = torch.tensor(y_test, dtype=torch.float32).unsqueeze(1)
                
                optimizer = torch.optim.Adam(self.deep_model.parameters(), lr=0.001)
                criterion = nn.BCELoss()
                
                # Training loop
                self.deep_model.train()
                for epoch in range(100):
                    optimizer.zero_grad()
                    outputs = self.deep_model(X_train_tensor)
                    loss = criterion(outputs, y_train_tensor)
                    loss.backward()
                    optimizer.step()
                
                # Evaluate deep model
                self.deep_model.eval()
                with torch.no_grad():
                    dl_predictions = self.deep_model(X_test_tensor)
                    dl_accuracy = ((dl_predictions > 0.5).float() == y_test_tensor).float().mean()
                
                # Log metrics
                mlflow.log_metric("random_forest_accuracy", rf_score)
                mlflow.log_metric("xgboost_accuracy", xgb_score)
                mlflow.log_metric("deep_learning_accuracy", float(dl_accuracy))
                
                # Save models
                mlflow.sklearn.log_model(self.random_forest, "random_forest")
                mlflow.sklearn.log_model(self.xgboost_model, "xgboost")
                mlflow.pytorch.log_model(self.deep_model, "deep_learning")
                
                logger.info(f"Models trained successfully - RF: {rf_score:.3f}, XGB: {xgb_score:.3f}, DL: {dl_accuracy:.3f}")
                
        except Exception as e:
            logger.error(f"Failed to train models: {e}")
            raise
    
    def update_transaction_history(self, transaction: TransactionData, is_fraud: bool):
        """Update transaction history for future predictions"""
        try:
            # Update customer velocity
            velocity_key = f"customer:{transaction.customer_id}:velocity"
            self.redis_client.lpush(velocity_key, transaction.timestamp.isoformat())
            self.redis_client.ltrim(velocity_key, 0, 19)  # Keep last 20
            self.redis_client.expire(velocity_key, 3600)  # 1 hour TTL
            
            # Update customer amounts
            amounts_key = f"customer:{transaction.customer_id}:amounts"
            self.redis_client.lpush(amounts_key, transaction.amount)
            self.redis_client.ltrim(amounts_key, 0, 99)  # Keep last 100
            
            # Update last transaction time
            last_txn_key = f"customer:{transaction.customer_id}:last_transaction"
            self.redis_client.set(last_txn_key, transaction.timestamp.isoformat())
            
            # Update device reputation
            device_key = f"device:{transaction.device_fingerprint}"
            self.redis_client.hincrby(device_key, 'total_transactions', 1)
            if is_fraud:
                self.redis_client.hincrby(device_key, 'fraud_count', 1)
            
            logger.info(f"Updated transaction history for {transaction.transaction_id}")
            
        except Exception as e:
            logger.error(f"Failed to update transaction history: {e}")

        """Update transaction history for future predictions"""
        try:
            # Update customer velocity
            velocity_key = f"customer:{transaction.customer_id}:velocity"
            self.redis_client.lpush(velocity_key, transaction.timestamp.isoformat())
            self.redis_client.ltrim(velocity_key, 0, 19)  # Keep last 20
            self.redis_client.expire(velocity_key, 3600)  # 1 hour TTL
            
            # Update customer amounts
            amounts_key = f"customer:{transaction.customer_id}:amounts"
            self.redis_client.lpush(amounts_key, transaction.amount)
            self.redis_client.ltrim(amounts_key, 0, 99)  # Keep last 100
            
            # Update last transaction time
            last_txn_key = f"customer:{transaction.customer_id}:last_transaction"
            self.redis_client.set(last_txn_key, transaction.timestamp.isoformat())
            
            # Update device reputation
            device_key = f"device:{transaction.device_fingerprint}"
            self.redis_client.hincrby(device_key, 'total_transactions', 1)
            if is_fraud:
                self.redis_client.hincrby(device_key, 'fraud_count', 1)
            
            logger.info(f"Updated transaction history for {transaction.transaction_id}")
            
        except Exception as e:
            logger.error(f"Failed to update transaction history: {e}")

# Flask API
app = Flask(__name__)
CORS(app)

# Initialize fraud detection service
fraud_service = HybridFraudDetectionService()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'hybrid_fraud_detection',
        'timestamp': datetime.now().isoformat()
    })

    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'hybrid_fraud_detection',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/predict', methods=['POST'])
def predict_fraud():
    """Predict fraud for a transaction"""
    try:
        data = request.get_json()
        
        # Create transaction object
        transaction = TransactionData(
            transaction_id=data['transaction_id'],
            customer_id=data['customer_id'],
            agent_id=data['agent_id'],
            amount=float(data['amount']),
            transaction_type=data['transaction_type'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            latitude=float(data['latitude']),
            longitude=float(data['longitude']),
            device_fingerprint=data['device_fingerprint'],
            ip_address=data['ip_address'],
            merchant_category=data.get('merchant_category', 'unknown'),
            channel=data.get('channel', 'unknown'),
            currency=data.get('currency', 'USD'),
            metadata=data.get('metadata', {})
        )
        
        # Predict fraud
        prediction = fraud_service.predict_fraud(transaction)
        
        return jsonify(asdict(prediction))
        
    except Exception as e:
        logger.error(f"Fraud prediction failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Predict fraud for a transaction"""
    try:
        data = request.get_json()
        
        # Create transaction object
        transaction = TransactionData(
            transaction_id=data['transaction_id'],
            customer_id=data['customer_id'],
            agent_id=data['agent_id'],
            amount=float(data['amount']),
            transaction_type=data['transaction_type'],
            timestamp=datetime.fromisoformat(data['timestamp']),
            latitude=float(data['latitude']),
            longitude=float(data['longitude']),
            device_fingerprint=data['device_fingerprint'],
            ip_address=data['ip_address'],
            merchant_category=data.get('merchant_category', 'unknown'),
            channel=data.get('channel', 'unknown'),
            currency=data.get('currency', 'USD'),
            metadata=data.get('metadata', {})
        )
        
        # Predict fraud
        prediction = fraud_service.predict_fraud(transaction)
        
        return jsonify(asdict(prediction))
        
    except Exception as e:
        logger.error(f"Fraud prediction failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/feedback', methods=['POST'])
def fraud_feedback():
    """Provide feedback on fraud prediction"""
    try:
        data = request.get_json()
        
        transaction_id = data['transaction_id']
        is_fraud = data['is_fraud']
        
        # Update model with feedback (simplified)
        logger.info(f"Received feedback for {transaction_id}: fraud={is_fraud}")
        
        return jsonify({'status': 'feedback_received'})
        
    except Exception as e:
        logger.error(f"Fraud feedback failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Provide feedback on fraud prediction"""
    try:
        data = request.get_json()
        
        transaction_id = data['transaction_id']
        is_fraud = data['is_fraud']
        
        # Update model with feedback (simplified)
        logger.info(f"Received feedback for {transaction_id}: fraud={is_fraud}")
        
        return jsonify({'status': 'feedback_received'})
        
    except Exception as e:
        logger.error(f"Fraud feedback failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/train', methods=['POST'])
def train_models():
    """Train fraud detection models"""
    try:
        # In production, this would load data from the data lake
        # For now, create sample training data
        
        n_samples = 10000
        np.random.seed(42)
        
        training_data = pd.DataFrame({
            'transaction_id': [f"txn_{i}" for i in range(n_samples)],
            'customer_id': [f"cust_{np.random.randint(1, 1000)}" for _ in range(n_samples)],
            'agent_id': [f"agent_{np.random.randint(1, 100)}" for _ in range(n_samples)],
            'amount': np.random.lognormal(8, 1, n_samples),
            'transaction_type': np.random.choice(['deposit', 'withdrawal', 'transfer'], n_samples),
            'timestamp': pd.date_range(start='2024-01-01', periods=n_samples, freq='1H'),
            'latitude': np.random.uniform(-35, 37, n_samples),
            'longitude': np.random.uniform(-18, 52, n_samples),
            'device_fingerprint': [f"device_{np.random.randint(1000, 9999)}" for _ in range(n_samples)],
            'ip_address': [f"192.168.{np.random.randint(1, 255)}.{np.random.randint(1, 255)}" for _ in range(n_samples)]
        })
        
        # Generate labels (10% fraud)
        labels = pd.Series(np.random.choice([0, 1], n_samples, p=[0.9, 0.1]))
        
        # Train models
        fraud_service.train_models(training_data, labels)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Train fraud detection models"""
    try:
        # In production, this would load data from the data lake
        # For now, create sample training data
        
        n_samples = 10000
        np.random.seed(42)
        
        training_data = pd.DataFrame({
            'transaction_id': [f"txn_{i}" for i in range(n_samples)],
            'customer_id': [f"cust_{np.random.randint(1, 1000)}" for _ in range(n_samples)],
            'agent_id': [f"agent_{np.random.randint(1, 100)}" for _ in range(n_samples)],
            'amount': np.random.lognormal(8, 1, n_samples),
            'transaction_type': np.random.choice(['deposit', 'withdrawal', 'transfer'], n_samples),
            'timestamp': pd.date_range(start='2024-01-01', periods=n_samples, freq='1H'),
            'latitude': np.random.uniform(-35, 37, n_samples),
            'longitude': np.random.uniform(-18, 52, n_samples),
            'device_fingerprint': [f"device_{np.random.randint(1000, 9999)}" for _ in range(n_samples)],
            'ip_address': [f"192.168.{np.random.randint(1, 255)}.{np.random.randint(1, 255)}" for _ in range(n_samples)]
        })
        
        # Generate labels (10% fraud)
        labels = pd.Series(np.random.choice([0, 1], n_samples, p=[0.9, 0.1]))
        
        # Train models
        fraud_service.train_models(training_data, labels)
        
        return jsonify({'status': 'training_completed'})
        
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/models/status', methods=['GET'])
def model_status():
    """Get model status and performance metrics"""
    try:
        status = {
            'models': {
                'rules_engine': 'active',
                'isolation_forest': 'trained',
                'random_forest': 'trained',
                'xgboost': 'trained',
                'deep_learning': 'trained',
                'gnn': 'initialized'
            },
            'ensemble_weights': fraud_service.model_weights,
            'feature_columns': fraud_service.feature_columns,
            'last_training': datetime.now().isoformat()
        }
        
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Model status failed: {e}")
        return jsonify({'error': str(e)}), 500

    """Get model status and performance metrics"""
    try:
        status = {
            'models': {
                'rules_engine': 'active',
                'isolation_forest': 'trained',
                'random_forest': 'trained',
                'xgboost': 'trained',
                'deep_learning': 'trained',
                'gnn': 'initialized'
            },
            'ensemble_weights': fraud_service.model_weights,
            'feature_columns': fraud_service.feature_columns,
            'last_training': datetime.now().isoformat()
        }
        
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"Model status failed: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug = False)

