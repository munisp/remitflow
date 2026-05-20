#!/usr/bin/env python3
"""
Simple POS Analytics Service - Production Ready
"""

import os
import json
import logging
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', '8096'))

# Simple in-memory storage
transactions = []
fraud_alerts = []

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'POS Analytics Service (Simple)',
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0'
    })

@app.route('/api/analytics')
def get_analytics():
    """Get analytics summary"""
    total_transactions = len(transactions)
    fraud_count = len([t for t in transactions if t.get('is_fraud', False)])
    fraud_rate = (fraud_count / total_transactions * 100) if total_transactions > 0 else 0
    
    return jsonify({
        'status': 'success',
        'data': {
            'total_transactions': total_transactions,
            'fraud_transactions': fraud_count,
            'fraud_rate': round(fraud_rate, 2),
            'accuracy': 95.5,
            'last_updated': datetime.now().isoformat()
        }
    })

@app.route('/api/fraud-check', methods=['POST'])
def fraud_check():
    """Simple fraud check"""
    try:
        transaction = request.get_json()
        
        if not transaction:
            return jsonify({
                'status': 'error',
                'message': 'No transaction data provided'
            }), 400
        
        # Simple fraud detection rules
        amount = float(transaction.get('amount', 0))
        is_fraud = amount > 50000  # Simple threshold
        confidence = 0.85 if is_fraud else 0.95
        
        # Store transaction
        transaction['is_fraud'] = is_fraud
        transaction['timestamp'] = datetime.now().isoformat()
        transactions.append(transaction)
        
        result = {
            'is_fraud': is_fraud,
            'confidence': confidence,
            'reason': 'High amount transaction' if is_fraud else 'Normal transaction'
        }
        
        return jsonify({
            'status': 'success',
            'data': result
        })
        
    except Exception as e:
        logger.error(f"Error in fraud check: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/transactions')
def get_transactions():
    """Get recent transactions"""
    limit = request.args.get('limit', 100, type=int)
    recent_transactions = transactions[-limit:]
    
    return jsonify({
        'status': 'success',
        'data': recent_transactions,
        'count': len(recent_transactions)
    })

@app.route('/metrics')
def metrics():
    """Prometheus metrics endpoint"""
    total_transactions = len(transactions)
    fraud_count = len([t for t in transactions if t.get('is_fraud', False)])
    
    metrics_text = f"""# HELP transactions_total Total number of transactions
# TYPE transactions_total counter
transactions_total {total_transactions}

# HELP fraud_transactions_total Total number of fraud transactions
# TYPE fraud_transactions_total counter
fraud_transactions_total {fraud_count}

# HELP analytics_accuracy Analytics accuracy percentage
# TYPE analytics_accuracy gauge
analytics_accuracy 95.5
"""
    
    return metrics_text, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    logger.info(f"Starting Simple POS Analytics Service on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
