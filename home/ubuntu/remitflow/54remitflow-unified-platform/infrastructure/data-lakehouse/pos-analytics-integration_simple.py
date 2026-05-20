#!/usr/bin/env python3
"""
Simple Lakehouse Service - Production Ready
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
PORT = int(os.getenv('PORT', '8097'))

# Simple in-memory data layers
bronze_data = []
silver_data = []
gold_data = []

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Lakehouse Service (Simple)',
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0'
    })

@app.route('/api/data', methods=['POST'])
def ingest_data():
    """Ingest data into bronze layer"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No data provided'
            }), 400
        
        record = {
            'id': len(bronze_data) + 1,
            'data': data,
            'timestamp': datetime.now().isoformat(),
            'layer': 'bronze'
        }
        
        bronze_data.append(record)
        
        return jsonify({
            'status': 'success',
            'record_id': record['id']
        })
        
    except Exception as e:
        logger.error(f"Error ingesting data: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/data/<layer>')
def get_data(layer):
    """Get data from specified layer"""
    try:
        if layer == 'bronze':
            data = bronze_data
        elif layer == 'silver':
            data = silver_data
        elif layer == 'gold':
            data = gold_data
        else:
            return jsonify({
                'status': 'error',
                'message': 'Invalid layer'
            }), 400
        
        limit = request.args.get('limit', 100, type=int)
        recent_data = data[-limit:]
        
        return jsonify({
            'status': 'success',
            'layer': layer,
            'data': recent_data,
            'total_count': len(data)
        })
        
    except Exception as e:
        logger.error(f"Error getting data: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/process')
def process_data():
    """Process data from bronze to silver to gold"""
    try:
        # Simple processing: move bronze to silver
        for record in bronze_data:
            if record not in silver_data:
                processed_record = record.copy()
                processed_record['layer'] = 'silver'
                processed_record['processed_at'] = datetime.now().isoformat()
                silver_data.append(processed_record)
        
        # Simple aggregation: create gold summaries
        if silver_data and len(gold_data) < len(silver_data):
            summary = {
                'id': len(gold_data) + 1,
                'summary': f"Processed {len(silver_data)} records",
                'layer': 'gold',
                'created_at': datetime.now().isoformat(),
                'record_count': len(silver_data)
            }
            gold_data.append(summary)
        
        return jsonify({
            'status': 'success',
            'processed': {
                'bronze': len(bronze_data),
                'silver': len(silver_data),
                'gold': len(gold_data)
            }
        })
        
    except Exception as e:
        logger.error(f"Error processing data: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/metrics')
def metrics():
    """Prometheus metrics endpoint"""
    metrics_text = f"""# HELP lakehouse_bronze_records Bronze layer record count
# TYPE lakehouse_bronze_records gauge
lakehouse_bronze_records {len(bronze_data)}

# HELP lakehouse_silver_records Silver layer record count
# TYPE lakehouse_silver_records gauge
lakehouse_silver_records {len(silver_data)}

# HELP lakehouse_gold_records Gold layer record count
# TYPE lakehouse_gold_records gauge
lakehouse_gold_records {len(gold_data)}
"""
    
    return metrics_text, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    logger.info(f"Starting Simple Lakehouse Service on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
