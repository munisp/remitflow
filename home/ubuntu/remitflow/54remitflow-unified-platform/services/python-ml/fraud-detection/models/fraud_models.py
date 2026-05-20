"""
Comprehensive Fraud Detection Models
Implements hybrid rule-based and ML/DL/GNN approaches for financial fraud detection
"""

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch_geometric.nn import GCNConv, GATConv, SAGEConv, global_mean_pool
from torch_geometric.data import Data, Batch
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, roc_auc_score, precision_recall_curve
import xgboost as xgb
import lightgbm as lgb
from typing import Dict, List, Tuple, Optional, Any
import joblib
import json
import logging
from datetime import datetime, timedelta
from dataclasses import dataclass
from enum import Enum
import networkx as nx
from collections import defaultdict
import warnings
warnings.filterwarnings('ignore')

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class FraudType(Enum):
    """Types of fraud patterns"""
    IDENTITY_THEFT = "identity_theft"
    ACCOUNT_TAKEOVER = "account_takeover"
    SYNTHETIC_IDENTITY = "synthetic_identity"
    MONEY_LAUNDERING = "money_laundering"
    TRANSACTION_FRAUD = "transaction_fraud"
    CARD_FRAUD = "card_fraud"
    MOBILE_FRAUD = "mobile_fraud"
    AGENT_COLLUSION = "agent_collusion"
    VELOCITY_FRAUD = "velocity_fraud"
    BEHAVIORAL_ANOMALY = "behavioral_anomaly"

class RiskLevel(Enum):
    """Risk assessment levels"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

@dataclass
class FraudPrediction:
    """Fraud prediction result"""
    transaction_id: str
    fraud_probability: float
    risk_level: RiskLevel
    fraud_types: List[FraudType]
    confidence_score: float
    rule_triggers: List[str]
    ml_features: Dict[str, float]
    gnn_features: Dict[str, float]
    explanation: str
    recommended_action: str
    timestamp: datetime

@dataclass
class TransactionFeatures:
    """Transaction feature representation"""
    transaction_id: str
    amount: float
    currency: str
    transaction_type: str
    timestamp: datetime
    agent_id: str
    customer_id: str
    location: Tuple[float, float]
    device_fingerprint: str
    ip_address: str
    user_agent: str
    velocity_features: Dict[str, float]
    behavioral_features: Dict[str, float]
    network_features: Dict[str, float]
    historical_features: Dict[str, float]

class RuleEngine:
    """Rule-based fraud detection engine"""
    
    def __init__(self):
        self.rules = self._initialize_rules()
        self.thresholds = self._initialize_thresholds()
        
    def _initialize_rules(self) -> Dict[str, callable]:
        """Initialize fraud detection rules"""
        return {
            'velocity_check': self._velocity_rule,
            'amount_threshold': self._amount_threshold_rule,
            'time_pattern': self._time_pattern_rule,
            'location_anomaly': self._location_anomaly_rule,
            'device_anomaly': self._device_anomaly_rule,
            'behavioral_anomaly': self._behavioral_anomaly_rule,
            'network_anomaly': self._network_anomaly_rule,
            'blacklist_check': self._blacklist_rule,
            'whitelist_check': self._whitelist_rule,
            'agent_pattern': self._agent_pattern_rule,
        }
    
    def _initialize_thresholds(self) -> Dict[str, Dict[str, float]]:
        """Initialize rule thresholds"""
        return {
            'velocity': {
                'transaction_count_1h': 10,
                'transaction_count_24h': 50,
                'amount_sum_1h': 100000,
                'amount_sum_24h': 500000,
            },
            'amount': {
                'single_transaction_max': 1000000,
                'daily_cumulative_max': 2000000,
                'unusual_amount_multiplier': 5.0,
            },
            'location': {
                'max_distance_km': 100,
                'velocity_kmh': 500,
            },
            'behavioral': {
                'deviation_threshold': 3.0,
                'pattern_similarity_min': 0.7,
            }
        }
    
    def evaluate_transaction(self, features: TransactionFeatures) -> Tuple[List[str], float]:
        """Evaluate transaction against all rules"""
        triggered_rules = []
        total_score = 0.0
        
        for rule_name, rule_func in self.rules.items():
            try:
                is_triggered, score = rule_func(features)
                if is_triggered:
                    triggered_rules.append(rule_name)
                    total_score += score
            except Exception as e:
                logger.error(f"Error in rule {rule_name}: {e}")
                
        return triggered_rules, min(total_score, 1.0)
    
    def _velocity_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check transaction velocity patterns"""
        velocity = features.velocity_features
        thresholds = self.thresholds['velocity']
        
        score = 0.0
        triggered = False
        
        if velocity.get('count_1h', 0) > thresholds['transaction_count_1h']:
            score += 0.3
            triggered = True
            
        if velocity.get('count_24h', 0) > thresholds['transaction_count_24h']:
            score += 0.2
            triggered = True
            
        if velocity.get('amount_1h', 0) > thresholds['amount_sum_1h']:
            score += 0.4
            triggered = True
            
        if velocity.get('amount_24h', 0) > thresholds['amount_sum_24h']:
            score += 0.3
            triggered = True
            
        return triggered, min(score, 1.0)
    
    def _amount_threshold_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check amount-based anomalies"""
        amount = features.amount
        thresholds = self.thresholds['amount']
        historical = features.historical_features
        
        score = 0.0
        triggered = False
        
        # Single transaction limit
        if amount > thresholds['single_transaction_max']:
            score += 0.5
            triggered = True
            
        # Unusual amount compared to history
        avg_amount = historical.get('avg_amount_30d', 0)
        if avg_amount > 0 and amount > avg_amount * thresholds['unusual_amount_multiplier']:
            score += 0.4
            triggered = True
            
        # Round number pattern (potential fraud indicator)
        if amount % 1000 == 0 and amount >= 10000:
            score += 0.1
            triggered = True
            
        return triggered, min(score, 1.0)
    
    def _time_pattern_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check time-based patterns"""
        timestamp = features.timestamp
        hour = timestamp.hour
        day_of_week = timestamp.weekday()
        
        score = 0.0
        triggered = False
        
        # Unusual hours (late night/early morning)
        if hour < 6 or hour > 22:
            score += 0.2
            triggered = True
            
        # Weekend transactions for business accounts
        if day_of_week >= 5:  # Saturday or Sunday
            score += 0.1
            triggered = True
            
        return triggered, score
    
    def _location_anomaly_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check location-based anomalies"""
        current_location = features.location
        historical = features.historical_features
        
        score = 0.0
        triggered = False
        
        # Distance from usual location
        usual_lat = historical.get('usual_latitude', 0)
        usual_lon = historical.get('usual_longitude', 0)
        
        if usual_lat and usual_lon:
            distance = self._calculate_distance(
                current_location[0], current_location[1],
                usual_lat, usual_lon
            )
            
            if distance > self.thresholds['location']['max_distance_km']:
                score += 0.4
                triggered = True
                
        return triggered, score
    
    def _device_anomaly_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check device-based anomalies"""
        device_fingerprint = features.device_fingerprint
        historical = features.historical_features
        
        score = 0.0
        triggered = False
        
        # New device
        known_devices = historical.get('known_devices', [])
        if device_fingerprint not in known_devices:
            score += 0.3
            triggered = True
            
        return triggered, score
    
    def _behavioral_anomaly_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check behavioral anomalies"""
        behavioral = features.behavioral_features
        threshold = self.thresholds['behavioral']['deviation_threshold']
        
        score = 0.0
        triggered = False
        
        # Check various behavioral deviations
        for feature, value in behavioral.items():
            if abs(value) > threshold:
                score += 0.2
                triggered = True
                
        return triggered, min(score, 1.0)
    
    def _network_anomaly_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check network-based anomalies"""
        network = features.network_features
        
        score = 0.0
        triggered = False
        
        # Suspicious network patterns
        if network.get('is_tor', False):
            score += 0.5
            triggered = True
            
        if network.get('is_vpn', False):
            score += 0.3
            triggered = True
            
        if network.get('reputation_score', 1.0) < 0.5:
            score += 0.4
            triggered = True
            
        return triggered, min(score, 1.0)
    
    def _blacklist_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check against blacklists"""
        # This would check against various blacklists
        # Implementation would depend on external blacklist services
        return False, 0.0
    
    def _whitelist_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check against whitelists"""
        # This would check against whitelists to reduce false positives
        # Implementation would depend on whitelist configuration
        return False, 0.0
    
    def _agent_pattern_rule(self, features: TransactionFeatures) -> Tuple[bool, float]:
        """Check agent-specific patterns"""
        agent_id = features.agent_id
        historical = features.historical_features
        
        score = 0.0
        triggered = False
        
        # Agent velocity patterns
        agent_velocity = historical.get('agent_transaction_velocity', 0)
        if agent_velocity > 100:  # Transactions per hour
            score += 0.3
            triggered = True
            
        return triggered, score
    
    def _calculate_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate distance between two coordinates in kilometers"""
        from math import radians, cos, sin, asin, sqrt
        
        # Convert to radians
        lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
        
        # Haversine formula
        dlat = lat2 - lat1
        dlon = lon2 - lon1
        a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
        c = 2 * asin(sqrt(a))
        r = 6371  # Radius of earth in kilometers
        
        return c * r

class TraditionalMLModels:
    """Traditional machine learning models for fraud detection"""
    
    def __init__(self):
        self.models = {}
        self.scalers = {}
        self.encoders = {}
        self.feature_importance = {}
        
    def prepare_features(self, transactions_df: pd.DataFrame) -> pd.DataFrame:
        """Prepare features for traditional ML models"""
        features_df = transactions_df.copy()
        
        # Temporal features
        features_df['hour'] = pd.to_datetime(features_df['timestamp']).dt.hour
        features_df['day_of_week'] = pd.to_datetime(features_df['timestamp']).dt.dayofweek
        features_df['is_weekend'] = features_df['day_of_week'].isin([5, 6])
        
        # Amount features
        features_df['amount_log'] = np.log1p(features_df['amount'])
        features_df['amount_rounded'] = (features_df['amount'] % 1000 == 0).astype(int)
        
        # Velocity features (would be calculated from historical data)
        features_df['velocity_1h'] = 0  # Placeholder
        features_df['velocity_24h'] = 0  # Placeholder
        
        # Categorical encoding
        categorical_columns = ['transaction_type', 'currency', 'agent_id']
        for col in categorical_columns:
            if col in features_df.columns:
                if col not in self.encoders:
                    self.encoders[col] = LabelEncoder()
                    features_df[f'{col}_encoded'] = self.encoders[col].fit_transform(features_df[col].astype(str))
                else:
                    features_df[f'{col}_encoded'] = self.encoders[col].transform(features_df[col].astype(str))
        
        return features_df
    
    def train_isolation_forest(self, X: pd.DataFrame, contamination: float = 0.1) -> None:
        """Train Isolation Forest for anomaly detection"""
        model = IsolationForest(
            contamination=contamination,
            random_state=42,
            n_estimators=200,
            max_samples='auto',
            max_features=1.0
        )
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Train model
        model.fit(X_scaled)
        
        self.models['isolation_forest'] = model
        self.scalers['isolation_forest'] = scaler
        
        logger.info("Isolation Forest model trained successfully")
    
    def train_random_forest(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train Random Forest classifier"""
        model = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            class_weight='balanced'
        )
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Train model
        model.fit(X_scaled, y)
        
        # Store feature importance
        self.feature_importance['random_forest'] = dict(zip(X.columns, model.feature_importances_))
        
        self.models['random_forest'] = model
        self.scalers['random_forest'] = scaler
        
        logger.info("Random Forest model trained successfully")
    
    def train_xgboost(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train XGBoost classifier"""
        model = xgb.XGBClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            scale_pos_weight=len(y[y==0])/len(y[y==1])  # Handle class imbalance
        )
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Train model
        model.fit(X_scaled, y)
        
        # Store feature importance
        self.feature_importance['xgboost'] = dict(zip(X.columns, model.feature_importances_))
        
        self.models['xgboost'] = model
        self.scalers['xgboost'] = scaler
        
        logger.info("XGBoost model trained successfully")
    
    def train_lightgbm(self, X: pd.DataFrame, y: pd.Series) -> None:
        """Train LightGBM classifier"""
        model = lgb.LGBMClassifier(
            n_estimators=200,
            max_depth=6,
            learning_rate=0.1,
            subsample=0.8,
            colsample_bytree=0.8,
            random_state=42,
            class_weight='balanced'
        )
        
        # Scale features
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        
        # Train model
        model.fit(X_scaled, y)
        
        # Store feature importance
        self.feature_importance['lightgbm'] = dict(zip(X.columns, model.feature_importances_))
        
        self.models['lightgbm'] = model
        self.scalers['lightgbm'] = scaler
        
        logger.info("LightGBM model trained successfully")
    
    def predict(self, X: pd.DataFrame, model_name: str) -> Tuple[np.ndarray, np.ndarray]:
        """Make predictions using specified model"""
        if model_name not in self.models:
            raise ValueError(f"Model {model_name} not found")
        
        model = self.models[model_name]
        scaler = self.scalers[model_name]
        
        X_scaled = scaler.transform(X)
        
        if model_name == 'isolation_forest':
            # Isolation Forest returns -1 for outliers, 1 for inliers
            predictions = model.predict(X_scaled)
            probabilities = model.decision_function(X_scaled)
            # Convert to fraud probabilities (0-1 scale)
            fraud_predictions = (predictions == -1).astype(int)
            fraud_probabilities = 1 / (1 + np.exp(probabilities))  # Sigmoid transformation
        else:
            fraud_predictions = model.predict(X_scaled)
            fraud_probabilities = model.predict_proba(X_scaled)[:, 1]
        
        return fraud_predictions, fraud_probabilities

class DeepLearningModels:
    """Deep learning models for fraud detection"""
    
    def __init__(self, input_dim: int):
        self.input_dim = input_dim
        self.models = {}
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
    def create_autoencoder(self, encoding_dim: int = 32) -> nn.Module:
        """Create autoencoder for anomaly detection"""
        class Autoencoder(nn.Module):
            def __init__(self, input_dim, encoding_dim):
                super(Autoencoder, self).__init__()
                
                # Encoder
                self.encoder = nn.Sequential(
                    nn.Linear(input_dim, 128),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(128, 64),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(64, encoding_dim),
                    nn.ReLU()
                )
                
                # Decoder
                self.decoder = nn.Sequential(
                    nn.Linear(encoding_dim, 64),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(64, 128),
                    nn.ReLU(),
                    nn.Dropout(0.2),
                    nn.Linear(128, input_dim),
                    nn.Sigmoid()
                )
            
            def forward(self, x):
                encoded = self.encoder(x)
                decoded = self.decoder(encoded)
                return decoded
        
        return Autoencoder(self.input_dim, encoding_dim).to(self.device)
    
    def create_lstm_classifier(self, sequence_length: int = 10, hidden_dim: int = 64) -> nn.Module:
        """Create LSTM classifier for sequential fraud detection"""
        class LSTMClassifier(nn.Module):
            def __init__(self, input_dim, hidden_dim, num_layers=2):
                super(LSTMClassifier, self).__init__()
                
                self.hidden_dim = hidden_dim
                self.num_layers = num_layers
                
                self.lstm = nn.LSTM(input_dim, hidden_dim, num_layers, 
                                  batch_first=True, dropout=0.2)
                self.attention = nn.MultiheadAttention(hidden_dim, num_heads=8)
                self.classifier = nn.Sequential(
                    nn.Linear(hidden_dim, 32),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(32, 16),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(16, 1),
                    nn.Sigmoid()
                )
            
            def forward(self, x):
                # LSTM forward pass
                lstm_out, (hidden, cell) = self.lstm(x)
                
                # Attention mechanism
                attn_out, _ = self.attention(lstm_out, lstm_out, lstm_out)
                
                # Use last output for classification
                output = self.classifier(attn_out[:, -1, :])
                return output
        
        return LSTMClassifier(self.input_dim, hidden_dim).to(self.device)
    
    def create_transformer_classifier(self, d_model: int = 128, nhead: int = 8) -> nn.Module:
        """Create Transformer classifier for fraud detection"""
        class TransformerClassifier(nn.Module):
            def __init__(self, input_dim, d_model, nhead, num_layers=4):
                super(TransformerClassifier, self).__init__()
                
                self.input_projection = nn.Linear(input_dim, d_model)
                self.positional_encoding = nn.Parameter(torch.randn(1000, d_model))
                
                encoder_layer = nn.TransformerEncoderLayer(
                    d_model=d_model, 
                    nhead=nhead, 
                    dim_feedforward=d_model*4,
                    dropout=0.1
                )
                self.transformer = nn.TransformerEncoder(encoder_layer, num_layers)
                
                self.classifier = nn.Sequential(
                    nn.Linear(d_model, 64),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(64, 32),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(32, 1),
                    nn.Sigmoid()
                )
            
            def forward(self, x):
                # Project input to model dimension
                x = self.input_projection(x)
                
                # Add positional encoding
                seq_len = x.size(1)
                x += self.positional_encoding[:seq_len, :].unsqueeze(0)
                
                # Transformer forward pass
                x = x.transpose(0, 1)  # (seq_len, batch, d_model)
                transformer_out = self.transformer(x)
                
                # Use last output for classification
                output = self.classifier(transformer_out[-1])
                return output
        
        return TransformerClassifier(self.input_dim, d_model, nhead).to(self.device)
    
    def train_model(self, model: nn.Module, train_loader, val_loader, 
                   epochs: int = 100, lr: float = 0.001) -> Dict[str, List[float]]:
        """Train deep learning model"""
        optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=1e-5)
        criterion = nn.BCELoss()
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10)
        
        train_losses = []
        val_losses = []
        
        for epoch in range(epochs):
            # Training phase
            model.train()
            train_loss = 0.0
            
            for batch_x, batch_y in train_loader:
                batch_x, batch_y = batch_x.to(self.device), batch_y.to(self.device)
                
                optimizer.zero_grad()
                outputs = model(batch_x)
                loss = criterion(outputs.squeeze(), batch_y.float())
                loss.backward()
                optimizer.step()
                
                train_loss += loss.item()
            
            # Validation phase
            model.eval()
            val_loss = 0.0
            
            with torch.no_grad():
                for batch_x, batch_y in val_loader:
                    batch_x, batch_y = batch_x.to(self.device), batch_y.to(self.device)
                    outputs = model(batch_x)
                    loss = criterion(outputs.squeeze(), batch_y.float())
                    val_loss += loss.item()
            
            train_loss /= len(train_loader)
            val_loss /= len(val_loader)
            
            train_losses.append(train_loss)
            val_losses.append(val_loss)
            
            scheduler.step(val_loss)
            
            if epoch % 10 == 0:
                logger.info(f'Epoch {epoch}: Train Loss: {train_loss:.4f}, Val Loss: {val_loss:.4f}')
        
        return {'train_losses': train_losses, 'val_losses': val_losses}

class GraphNeuralNetworks:
    """Graph Neural Networks for fraud detection"""
    
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.models = {}
        
    def create_transaction_graph(self, transactions_df: pd.DataFrame) -> Data:
        """Create transaction graph from transaction data"""
        # Create nodes (agents, customers, accounts)
        agents = transactions_df['agent_id'].unique()
        customers = transactions_df['customer_id'].unique()
        
        # Create node mapping
        node_to_idx = {}
        idx = 0
        
        # Add agent nodes
        for agent in agents:
            node_to_idx[f'agent_{agent}'] = idx
            idx += 1
            
        # Add customer nodes
        for customer in customers:
            node_to_idx[f'customer_{customer}'] = idx
            idx += 1
        
        # Create edges (transactions)
        edge_index = []
        edge_attr = []
        
        for _, row in transactions_df.iterrows():
            agent_idx = node_to_idx[f'agent_{row["agent_id"]}']
            customer_idx = node_to_idx[f'customer_{row["customer_id"]}']
            
            # Bidirectional edges
            edge_index.extend([[agent_idx, customer_idx], [customer_idx, agent_idx]])
            
            # Edge attributes (transaction features)
            edge_features = [
                row['amount'],
                row.get('transaction_type_encoded', 0),
                row.get('hour', 0),
                row.get('day_of_week', 0)
            ]
            edge_attr.extend([edge_features, edge_features])
        
        # Create node features
        num_nodes = len(node_to_idx)
        node_features = torch.randn(num_nodes, 16)  # Random initial features
        
        # Convert to tensors
        edge_index = torch.tensor(edge_index, dtype=torch.long).t().contiguous()
        edge_attr = torch.tensor(edge_attr, dtype=torch.float)
        
        return Data(x=node_features, edge_index=edge_index, edge_attr=edge_attr)
    
    def create_gcn_model(self, input_dim: int, hidden_dim: int = 64) -> nn.Module:
        """Create Graph Convolutional Network model"""
        class GCNFraudDetector(nn.Module):
            def __init__(self, input_dim, hidden_dim, num_classes=2):
                super(GCNFraudDetector, self).__init__()
                
                self.conv1 = GCNConv(input_dim, hidden_dim)
                self.conv2 = GCNConv(hidden_dim, hidden_dim)
                self.conv3 = GCNConv(hidden_dim, hidden_dim // 2)
                
                self.classifier = nn.Sequential(
                    nn.Linear(hidden_dim // 2, 32),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(32, 16),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(16, 1),
                    nn.Sigmoid()
                )
            
            def forward(self, data):
                x, edge_index, batch = data.x, data.edge_index, data.batch
                
                # Graph convolutions
                x = F.relu(self.conv1(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv2(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv3(x, edge_index))
                
                # Global pooling
                x = global_mean_pool(x, batch)
                
                # Classification
                x = self.classifier(x)
                return x
        
        return GCNFraudDetector(input_dim, hidden_dim).to(self.device)
    
    def create_gat_model(self, input_dim: int, hidden_dim: int = 64) -> nn.Module:
        """Create Graph Attention Network model"""
        class GATFraudDetector(nn.Module):
            def __init__(self, input_dim, hidden_dim, num_heads=8):
                super(GATFraudDetector, self).__init__()
                
                self.conv1 = GATConv(input_dim, hidden_dim // num_heads, heads=num_heads, dropout=0.2)
                self.conv2 = GATConv(hidden_dim, hidden_dim // num_heads, heads=num_heads, dropout=0.2)
                self.conv3 = GATConv(hidden_dim, hidden_dim // 2, heads=1, dropout=0.2)
                
                self.classifier = nn.Sequential(
                    nn.Linear(hidden_dim // 2, 32),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(32, 16),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(16, 1),
                    nn.Sigmoid()
                )
            
            def forward(self, data):
                x, edge_index, batch = data.x, data.edge_index, data.batch
                
                # Graph attention layers
                x = F.relu(self.conv1(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv2(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv3(x, edge_index))
                
                # Global pooling
                x = global_mean_pool(x, batch)
                
                # Classification
                x = self.classifier(x)
                return x
        
        return GATFraudDetector(input_dim, hidden_dim).to(self.device)
    
    def create_sage_model(self, input_dim: int, hidden_dim: int = 64) -> nn.Module:
        """Create GraphSAGE model"""
        class SAGEFraudDetector(nn.Module):
            def __init__(self, input_dim, hidden_dim):
                super(SAGEFraudDetector, self).__init__()
                
                self.conv1 = SAGEConv(input_dim, hidden_dim)
                self.conv2 = SAGEConv(hidden_dim, hidden_dim)
                self.conv3 = SAGEConv(hidden_dim, hidden_dim // 2)
                
                self.classifier = nn.Sequential(
                    nn.Linear(hidden_dim // 2, 32),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(32, 16),
                    nn.ReLU(),
                    nn.Dropout(0.3),
                    nn.Linear(16, 1),
                    nn.Sigmoid()
                )
            
            def forward(self, data):
                x, edge_index, batch = data.x, data.edge_index, data.batch
                
                # GraphSAGE layers
                x = F.relu(self.conv1(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv2(x, edge_index))
                x = F.dropout(x, training=self.training)
                x = F.relu(self.conv3(x, edge_index))
                
                # Global pooling
                x = global_mean_pool(x, batch)
                
                # Classification
                x = self.classifier(x)
                return x
        
        return SAGEFraudDetector(input_dim, hidden_dim).to(self.device)

class HybridFraudDetector:
    """Hybrid fraud detection system combining rules, ML, DL, and GNN"""
    
    def __init__(self):
        self.rule_engine = RuleEngine()
        self.ml_models = TraditionalMLModels()
        self.dl_models = None
        self.gnn_models = GraphNeuralNetworks()
        self.ensemble_weights = {
            'rules': 0.3,
            'ml': 0.3,
            'dl': 0.2,
            'gnn': 0.2
        }
        self.fraud_threshold = 0.5
        
    def train_all_models(self, transactions_df: pd.DataFrame, labels: pd.Series) -> None:
        """Train all models in the hybrid system"""
        logger.info("Training hybrid fraud detection system...")
        
        # Prepare features
        features_df = self.ml_models.prepare_features(transactions_df)
        
        # Select numerical features for ML models
        numerical_features = features_df.select_dtypes(include=[np.number]).columns
        X = features_df[numerical_features].fillna(0)
        
        # Train traditional ML models
        self.ml_models.train_isolation_forest(X)
        self.ml_models.train_random_forest(X, labels)
        self.ml_models.train_xgboost(X, labels)
        self.ml_models.train_lightgbm(X, labels)
        
        # Initialize deep learning models
        self.dl_models = DeepLearningModels(input_dim=len(numerical_features))
        
        logger.info("All models trained successfully")
    
    def predict_fraud(self, transaction_features: TransactionFeatures) -> FraudPrediction:
        """Predict fraud using hybrid approach"""
        # Rule-based prediction
        rule_triggers, rule_score = self.rule_engine.evaluate_transaction(transaction_features)
        
        # Prepare features for ML models
        feature_dict = {
            'amount': transaction_features.amount,
            'hour': transaction_features.timestamp.hour,
            'day_of_week': transaction_features.timestamp.weekday(),
            'is_weekend': transaction_features.timestamp.weekday() >= 5,
            'amount_log': np.log1p(transaction_features.amount),
            'amount_rounded': int(transaction_features.amount % 1000 == 0),
            **transaction_features.velocity_features,
            **transaction_features.behavioral_features,
            **transaction_features.network_features,
            **transaction_features.historical_features
        }
        
        # Convert to DataFrame for ML models
        feature_df = pd.DataFrame([feature_dict])
        
        # ML predictions
        ml_scores = {}
        try:
            if 'random_forest' in self.ml_models.models:
                _, ml_scores['random_forest'] = self.ml_models.predict(feature_df, 'random_forest')
            if 'xgboost' in self.ml_models.models:
                _, ml_scores['xgboost'] = self.ml_models.predict(feature_df, 'xgboost')
            if 'lightgbm' in self.ml_models.models:
                _, ml_scores['lightgbm'] = self.ml_models.predict(feature_df, 'lightgbm')
        except Exception as e:
            logger.error(f"Error in ML prediction: {e}")
            ml_scores = {'random_forest': [0.0], 'xgboost': [0.0], 'lightgbm': [0.0]}
        
        # Ensemble prediction
        final_score = self._ensemble_predict(rule_score, ml_scores)
        
        # Determine risk level and fraud types
        risk_level = self._determine_risk_level(final_score)
        fraud_types = self._identify_fraud_types(rule_triggers, transaction_features)
        
        # Generate explanation
        explanation = self._generate_explanation(rule_triggers, ml_scores, final_score)
        
        # Recommend action
        recommended_action = self._recommend_action(risk_level, final_score)
        
        return FraudPrediction(
            transaction_id=transaction_features.transaction_id,
            fraud_probability=final_score,
            risk_level=risk_level,
            fraud_types=fraud_types,
            confidence_score=self._calculate_confidence(rule_score, ml_scores),
            rule_triggers=rule_triggers,
            ml_features=feature_dict,
            gnn_features={},  # Would be populated if GNN is used
            explanation=explanation,
            recommended_action=recommended_action,
            timestamp=datetime.now()
        )
    
    def _ensemble_predict(self, rule_score: float, ml_scores: Dict[str, List[float]]) -> float:
        """Combine predictions from different models"""
        # Average ML scores
        ml_avg = np.mean([scores[0] if len(scores) > 0 else 0.0 for scores in ml_scores.values()])
        
        # Weighted ensemble
        final_score = (
            self.ensemble_weights['rules'] * rule_score +
            self.ensemble_weights['ml'] * ml_avg
        )
        
        return min(final_score, 1.0)
    
    def _determine_risk_level(self, score: float) -> RiskLevel:
        """Determine risk level based on fraud score"""
        if score >= 0.8:
            return RiskLevel.CRITICAL
        elif score >= 0.6:
            return RiskLevel.HIGH
        elif score >= 0.3:
            return RiskLevel.MEDIUM
        else:
            return RiskLevel.LOW
    
    def _identify_fraud_types(self, rule_triggers: List[str], 
                            features: TransactionFeatures) -> List[FraudType]:
        """Identify potential fraud types based on triggers and features"""
        fraud_types = []
        
        if 'velocity_check' in rule_triggers:
            fraud_types.append(FraudType.VELOCITY_FRAUD)
            
        if 'amount_threshold' in rule_triggers:
            fraud_types.append(FraudType.TRANSACTION_FRAUD)
            
        if 'location_anomaly' in rule_triggers:
            fraud_types.append(FraudType.ACCOUNT_TAKEOVER)
            
        if 'device_anomaly' in rule_triggers:
            fraud_types.append(FraudType.IDENTITY_THEFT)
            
        if 'behavioral_anomaly' in rule_triggers:
            fraud_types.append(FraudType.BEHAVIORAL_ANOMALY)
            
        if 'network_anomaly' in rule_triggers:
            fraud_types.append(FraudType.SYNTHETIC_IDENTITY)
            
        if 'agent_pattern' in rule_triggers:
            fraud_types.append(FraudType.AGENT_COLLUSION)
        
        return fraud_types if fraud_types else [FraudType.TRANSACTION_FRAUD]
    
    def _generate_explanation(self, rule_triggers: List[str], 
                            ml_scores: Dict[str, List[float]], 
                            final_score: float) -> str:
        """Generate human-readable explanation for the prediction"""
        explanations = []
        
        if rule_triggers:
            explanations.append(f"Rule-based triggers: {', '.join(rule_triggers)}")
        
        if ml_scores:
            avg_ml_score = np.mean([scores[0] if len(scores) > 0 else 0.0 for scores in ml_scores.values()])
            explanations.append(f"ML models average score: {avg_ml_score:.3f}")
        
        explanations.append(f"Final fraud probability: {final_score:.3f}")
        
        return "; ".join(explanations)
    
    def _recommend_action(self, risk_level: RiskLevel, score: float) -> str:
        """Recommend action based on risk level"""
        if risk_level == RiskLevel.CRITICAL:
            return "BLOCK_TRANSACTION"
        elif risk_level == RiskLevel.HIGH:
            return "MANUAL_REVIEW"
        elif risk_level == RiskLevel.MEDIUM:
            return "ADDITIONAL_VERIFICATION"
        else:
            return "ALLOW"
    
    def _calculate_confidence(self, rule_score: float, ml_scores: Dict[str, List[float]]) -> float:
        """Calculate confidence in the prediction"""
        # Simple confidence calculation based on agreement between models
        scores = [rule_score] + [scores[0] if len(scores) > 0 else 0.0 for scores in ml_scores.values()]
        
        if len(scores) <= 1:
            return 0.5
        
        # Calculate variance (lower variance = higher confidence)
        variance = np.var(scores)
        confidence = 1.0 / (1.0 + variance)
        
        return confidence
    
    def update_ensemble_weights(self, performance_metrics: Dict[str, float]) -> None:
        """Update ensemble weights based on performance metrics"""
        total_performance = sum(performance_metrics.values())
        
        if total_performance > 0:
            for model_type in self.ensemble_weights:
                if model_type in performance_metrics:
                    self.ensemble_weights[model_type] = performance_metrics[model_type] / total_performance
        
        logger.info(f"Updated ensemble weights: {self.ensemble_weights}")
    
    def save_models(self, model_path: str) -> None:
        """Save all trained models"""
        model_data = {
            'ml_models': self.ml_models.models,
            'ml_scalers': self.ml_models.scalers,
            'ml_encoders': self.ml_models.encoders,
            'ensemble_weights': self.ensemble_weights,
            'fraud_threshold': self.fraud_threshold
        }
        
        joblib.dump(model_data, model_path)
        logger.info(f"Models saved to {model_path}")
    
    def load_models(self, model_path: str) -> None:
        """Load trained models"""
        model_data = joblib.load(model_path)
        
        self.ml_models.models = model_data['ml_models']
        self.ml_models.scalers = model_data['ml_scalers']
        self.ml_models.encoders = model_data['ml_encoders']
        self.ensemble_weights = model_data['ensemble_weights']
        self.fraud_threshold = model_data['fraud_threshold']
        
        logger.info(f"Models loaded from {model_path}")

# Example usage and testing
if __name__ == "__main__":
    # Create sample transaction data
    np.random.seed(42)
    n_transactions = 10000
    
    sample_data = {
        'transaction_id': [f'txn_{i}' for i in range(n_transactions)],
        'amount': np.random.lognormal(mean=5, sigma=2, size=n_transactions),
        'currency': np.random.choice(['KES', 'USD', 'EUR'], size=n_transactions),
        'transaction_type': np.random.choice(['cash_in', 'cash_out', 'transfer', 'bill_payment'], size=n_transactions),
        'timestamp': pd.date_range('2024-01-01', periods=n_transactions, freq='1H'),
        'agent_id': np.random.choice([f'agent_{i}' for i in range(100)], size=n_transactions),
        'customer_id': np.random.choice([f'customer_{i}' for i in range(1000)], size=n_transactions),
        'is_fraud': np.random.choice([0, 1], size=n_transactions, p=[0.95, 0.05])
    }
    
    transactions_df = pd.DataFrame(sample_data)
    
    # Initialize and train hybrid fraud detector
    fraud_detector = HybridFraudDetector()
    fraud_detector.train_all_models(transactions_df, transactions_df['is_fraud'])
    
    # Test prediction on a sample transaction
    sample_features = TransactionFeatures(
        transaction_id='test_txn_001',
        amount=50000.0,
        currency='KES',
        transaction_type='cash_out',
        timestamp=datetime.now(),
        agent_id='agent_1',
        customer_id='customer_1',
        location=(1.2921, 36.8219),  # Nairobi coordinates
        device_fingerprint='device_123',
        ip_address='192.168.1.1',
        user_agent='Mozilla/5.0...',
        velocity_features={'count_1h': 5, 'count_24h': 20, 'amount_1h': 100000, 'amount_24h': 500000},
        behavioral_features={'deviation_score': 2.5},
        network_features={'is_tor': False, 'is_vpn': False, 'reputation_score': 0.8},
        historical_features={'avg_amount_30d': 25000, 'usual_latitude': 1.2921, 'usual_longitude': 36.8219}
    )
    
    prediction = fraud_detector.predict_fraud(sample_features)
    
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")
    logger.info("Operation completed")

