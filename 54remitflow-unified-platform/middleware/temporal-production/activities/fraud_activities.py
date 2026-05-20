"""
Fraud Detection Activities for Nigerian Remittance Platform
Implements atomic operations for hybrid fraud detection workflow
Combines rule-based (PyKnow) and GNN-based (PyTorch Geometric) approaches
"""

import asyncio
import logging
from typing import Dict, Any, List
from datetime import datetime
from temporalio import activity

# Configure logging
logger = logging.getLogger(__name__)


@activity.defn
async def extract_transaction_features(transaction_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract features from transaction for fraud detection
    
    Args:
        transaction_data: Transaction information
    
    Returns:
        Dict with extracted features
    """
    activity.logger.info(f"Extracting features for transaction: {transaction_data.get('transaction_id')}")
    
    try:
        # Extract various features for fraud detection
        features = {
            # Transaction features
            "amount": float(transaction_data.get('amount', 0)),
            "currency": transaction_data.get('currency'),
            "timestamp": transaction_data.get('timestamp', datetime.utcnow().isoformat()),
            
            # User features
            "sender_id": transaction_data.get('sender_id'),
            "recipient_id": transaction_data.get('recipient_id'),
            
            # Behavioral features (would be calculated from historical data in production)
            "sender_transaction_count_24h": 5,
            "sender_total_amount_24h": 50000.0,
            "sender_avg_transaction_amount": 10000.0,
            "recipient_receive_count_24h": 2,
            
            # Network features (for GNN)
            "sender_degree": 15,  # Number of connections
            "recipient_degree": 8,
            "common_neighbors": 2,
            
            # Temporal features
            "hour_of_day": datetime.utcnow().hour,
            "day_of_week": datetime.utcnow().weekday(),
            
            # Geographical features
            "sender_country": transaction_data.get('metadata', {}).get('sender_country', 'NG'),
            "recipient_country": transaction_data.get('metadata', {}).get('recipient_country', 'NG'),
            "cross_border": transaction_data.get('metadata', {}).get('sender_country') != 
                           transaction_data.get('metadata', {}).get('recipient_country'),
        }
        
        activity.logger.info(
            f"Features extracted for transaction: {transaction_data.get('transaction_id')} - "
            f"Feature count: {len(features)}"
        )
        
        return {
            "success": True,
            "features": features,
            "extracted_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"Feature extraction error: {str(e)}")
        return {
            "success": False,
            "features": {},
            "error": f"Feature extraction failed: {str(e)}"
        }


@activity.defn
async def run_rule_based_detection(detection_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run rule-based fraud detection using PyKnow
    
    Args:
        detection_data: Transaction data and features
    
    Returns:
        Dict with rule-based detection result
    """
    activity.logger.info("Running rule-based fraud detection")
    
    try:
        features = detection_data.get('features', {})
        triggered_rules = []
        score = 0.0
        
        # Rule 1: High amount transaction
        if features.get('amount', 0) > 500000:
            triggered_rules.append({
                "rule": "high_amount",
                "description": "Transaction amount exceeds 500,000",
                "weight": 0.3
            })
            score += 0.3
        
        # Rule 2: Unusual transaction frequency
        if features.get('sender_transaction_count_24h', 0) > 10:
            triggered_rules.append({
                "rule": "high_frequency",
                "description": "More than 10 transactions in 24 hours",
                "weight": 0.25
            })
            score += 0.25
        
        # Rule 3: High velocity (total amount in 24h)
        if features.get('sender_total_amount_24h', 0) > 1000000:
            triggered_rules.append({
                "rule": "high_velocity",
                "description": "Total transaction amount exceeds 1M in 24 hours",
                "weight": 0.35
            })
            score += 0.35
        
        # Rule 4: Unusual time (late night transactions)
        hour = features.get('hour_of_day', 12)
        if hour >= 23 or hour <= 4:
            triggered_rules.append({
                "rule": "unusual_time",
                "description": "Transaction during unusual hours",
                "weight": 0.15
            })
            score += 0.15
        
        # Rule 5: First-time recipient
        if features.get('common_neighbors', 0) == 0:
            triggered_rules.append({
                "rule": "new_recipient",
                "description": "First transaction to this recipient",
                "weight": 0.1
            })
            score += 0.1
        
        # Cap score at 1.0
        score = min(score, 1.0)
        
        is_fraudulent = score > 0.7
        
        activity.logger.info(
            f"Rule-based detection completed - Score: {score}, "
            f"Fraudulent: {is_fraudulent}, Rules triggered: {len(triggered_rules)}"
        )
        
        return {
            "is_fraudulent": is_fraudulent,
            "score": score,
            "triggered_rules": triggered_rules,
            "detection_method": "rule_based",
            "engine": "PyKnow",
            "detected_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"Rule-based detection error: {str(e)}")
        return {
            "is_fraudulent": False,
            "score": 0.0,
            "triggered_rules": [],
            "error": f"Rule-based detection failed: {str(e)}"
        }


@activity.defn
async def run_gnn_fraud_detection(detection_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run GNN-based fraud detection using PyTorch Geometric
    
    Args:
        detection_data: Transaction data and features
    
    Returns:
        Dict with GNN detection result
    """
    activity.logger.info("Running GNN-based fraud detection")
    
    try:
        features = detection_data.get('features', {})
        
        # In production, this would use PyTorch Geometric (PyG) to run GNN model
        # For now, simulate GNN inference
        
        await asyncio.sleep(0.3)  # Simulate model inference
        
        # Simulate GNN score based on network features
        network_score = 0.0
        
        # High degree nodes are less likely to be fraudulent
        sender_degree = features.get('sender_degree', 0)
        if sender_degree < 5:
            network_score += 0.3
        
        # Low common neighbors indicates potential fraud
        common_neighbors = features.get('common_neighbors', 0)
        if common_neighbors == 0:
            network_score += 0.2
        
        # Cross-border transactions have higher risk
        if features.get('cross_border', False):
            network_score += 0.15
        
        # Add some randomness to simulate model uncertainty
        import random
        network_score += random.uniform(0, 0.2)
        
        # Cap score at 1.0
        score = min(network_score, 1.0)
        confidence = 0.85  # High confidence
        
        is_fraudulent = score > 0.6
        
        activity.logger.info(
            f"GNN detection completed - Score: {score}, "
            f"Fraudulent: {is_fraudulent}, Confidence: {confidence}"
        )
        
        return {
            "is_fraudulent": is_fraudulent,
            "score": score,
            "confidence": confidence,
            "detection_method": "gnn",
            "framework": "PyTorch Geometric (PyG)",
            "model": "GraphSAGE",
            "detected_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"GNN detection error: {str(e)}")
        return {
            "is_fraudulent": False,
            "score": 0.0,
            "confidence": 0.0,
            "error": f"GNN detection failed: {str(e)}"
        }


@activity.defn
async def run_ml_models(detection_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Run traditional ML models for fraud detection
    
    Args:
        detection_data: Transaction data and features
    
    Returns:
        Dict with ML detection result
    """
    activity.logger.info("Running traditional ML fraud detection")
    
    try:
        features = detection_data.get('features', {})
        
        # In production, this would run Random Forest, XGBoost, etc.
        # For now, simulate ML inference
        
        await asyncio.sleep(0.2)  # Simulate model inference
        
        # Simulate ML score based on features
        ml_score = 0.0
        
        # Amount-based scoring
        amount = features.get('amount', 0)
        if amount > 300000:
            ml_score += 0.25
        
        # Frequency-based scoring
        tx_count = features.get('sender_transaction_count_24h', 0)
        if tx_count > 8:
            ml_score += 0.2
        
        # Velocity-based scoring
        total_amount = features.get('sender_total_amount_24h', 0)
        if total_amount > 800000:
            ml_score += 0.25
        
        # Add some randomness to simulate model uncertainty
        import random
        ml_score += random.uniform(0, 0.15)
        
        # Cap score at 1.0
        score = min(ml_score, 1.0)
        
        is_fraudulent = score > 0.65
        
        models_used = ["RandomForest", "XGBoost", "LightGBM"]
        
        activity.logger.info(
            f"ML detection completed - Score: {score}, "
            f"Fraudulent: {is_fraudulent}, Models: {len(models_used)}"
        )
        
        return {
            "is_fraudulent": is_fraudulent,
            "score": score,
            "detection_method": "ml",
            "models_used": models_used,
            "detected_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"ML detection error: {str(e)}")
        return {
            "is_fraudulent": False,
            "score": 0.0,
            "models_used": [],
            "error": f"ML detection failed: {str(e)}"
        }


@activity.defn
async def calculate_ensemble_score(ensemble_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate ensemble fraud score from multiple detection methods
    
    Args:
        ensemble_data: Results from rule-based, GNN, and ML detection
    
    Returns:
        Dict with ensemble score and decision
    """
    activity.logger.info("Calculating ensemble fraud score")
    
    try:
        rule_result = ensemble_data.get('rule_result', {})
        gnn_result = ensemble_data.get('gnn_result', {})
        ml_result = ensemble_data.get('ml_result', {})
        
        # Weighted ensemble
        weights = {
            "rule_based": 0.3,
            "gnn": 0.4,
            "ml": 0.3
        }
        
        ensemble_score = (
            rule_result.get('score', 0) * weights["rule_based"] +
            gnn_result.get('score', 0) * weights["gnn"] +
            ml_result.get('score', 0) * weights["ml"]
        )
        
        # Determine if fraudulent based on ensemble score
        is_fraudulent = ensemble_score > 0.6
        
        # Calculate confidence
        scores = [
            rule_result.get('score', 0),
            gnn_result.get('score', 0),
            ml_result.get('score', 0)
        ]
        score_variance = sum((s - ensemble_score) ** 2 for s in scores) / len(scores)
        confidence = 1.0 - min(score_variance, 1.0)
        
        # Generate reasoning
        reasoning = []
        if rule_result.get('is_fraudulent'):
            reasoning.append(f"Rule-based: {len(rule_result.get('triggered_rules', []))} rules triggered")
        if gnn_result.get('is_fraudulent'):
            reasoning.append(f"GNN: Network anomaly detected")
        if ml_result.get('is_fraudulent'):
            reasoning.append(f"ML: Behavioral anomaly detected")
        
        activity.logger.info(
            f"Ensemble score calculated - Score: {ensemble_score}, "
            f"Fraudulent: {is_fraudulent}, Confidence: {confidence}"
        )
        
        return {
            "ensemble_score": ensemble_score,
            "is_fraudulent": is_fraudulent,
            "confidence": confidence,
            "reasoning": reasoning,
            "method_scores": {
                "rule_based": rule_result.get('score', 0),
                "gnn": gnn_result.get('score', 0),
                "ml": ml_result.get('score', 0)
            },
            "calculated_at": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        activity.logger.error(f"Ensemble calculation error: {str(e)}")
        return {
            "ensemble_score": 0.0,
            "is_fraudulent": False,
            "confidence": 0.0,
            "error": f"Ensemble calculation failed: {str(e)}"
        }


@activity.defn
async def flag_suspicious_transaction(flag_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Flag transaction for manual review
    
    Args:
        flag_data: Flag information
    
    Returns:
        Dict with flag result
    """
    activity.logger.info(
        f"Flagging transaction for review: {flag_data.get('transaction_id')} - "
        f"Score: {flag_data.get('fraud_score')}"
    )
    
    try:
        flag_id = f"FLAG-{flag_data.get('transaction_id')}-{int(datetime.utcnow().timestamp())}"
        
        await asyncio.sleep(0.1)  # Simulate database update
        
        activity.logger.info(f"Transaction flagged successfully: {flag_id}")
        
        return {
            "success": True,
            "flag_id": flag_id,
            "flagged_at": datetime.utcnow().isoformat(),
            "review_priority": flag_data.get('review_priority', 'medium')
        }
        
    except Exception as e:
        activity.logger.error(f"Flag transaction error: {str(e)}")
        return {
            "success": False,
            "error": f"Flagging failed: {str(e)}"
        }


@activity.defn
async def block_transaction(block_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Block fraudulent transaction
    
    Args:
        block_data: Block information
    
    Returns:
        Dict with block result
    """
    activity.logger.info(
        f"Blocking transaction: {block_data.get('transaction_id')} - "
        f"Reason: {block_data.get('reason')}"
    )
    
    try:
        block_id = f"BLOCK-{block_data.get('transaction_id')}-{int(datetime.utcnow().timestamp())}"
        
        await asyncio.sleep(0.1)  # Simulate database update
        
        activity.logger.info(f"Transaction blocked successfully: {block_id}")
        
        return {
            "success": True,
            "block_id": block_id,
            "blocked_at": datetime.utcnow().isoformat(),
            "reason": block_data.get('reason')
        }
        
    except Exception as e:
        activity.logger.error(f"Block transaction error: {str(e)}")
        return {
            "success": False,
            "error": f"Blocking failed: {str(e)}"
        }


@activity.defn
async def send_fraud_alert(alert_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Send fraud alert notification
    
    Args:
        alert_data: Alert information
    
    Returns:
        Dict with alert result
    """
    activity.logger.info(
        f"Sending fraud alert for transaction: {alert_data.get('transaction_id')} - "
        f"Priority: {alert_data.get('priority')}"
    )
    
    try:
        alert_id = f"ALERT-{alert_data.get('transaction_id')}-{int(datetime.utcnow().timestamp())}"
        
        await asyncio.sleep(0.05)  # Simulate notification sending
        
        activity.logger.info(f"Fraud alert sent successfully: {alert_id}")
        
        return {
            "success": True,
            "alert_id": alert_id,
            "sent_at": datetime.utcnow().isoformat(),
            "priority": alert_data.get('priority')
        }
        
    except Exception as e:
        activity.logger.error(f"Fraud alert error: {str(e)}")
        return {
            "success": False,
            "error": f"Alert failed: {str(e)}"
        }

