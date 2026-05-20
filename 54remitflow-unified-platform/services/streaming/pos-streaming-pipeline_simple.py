#!/usr/bin/env python3
"""
Simple Streaming Service - Production Ready
"""

import os
import json
import logging
import time
import threading
from datetime import datetime
from flask import Flask, jsonify, request
from flask_cors import CORS
from collections import deque

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Configuration
HOST = os.getenv('HOST', '0.0.0.0')
PORT = int(os.getenv('PORT', '8098'))

# Simple in-memory message queue
message_queue = deque(maxlen=10000)
message_id_counter = 0

@app.route('/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Streaming Service (Simple)',
        'timestamp': datetime.now().isoformat(),
        'version': '1.0.0'
    })

@app.route('/api/stream', methods=['POST'])
def publish_message():
    """Publish message to stream"""
    global message_id_counter
    
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No data provided'
            }), 400
        
        message_id_counter += 1
        message = {
            'id': message_id_counter,
            'topic': data.get('topic', 'default'),
            'data': data.get('data', {}),
            'timestamp': datetime.now().isoformat()
        }
        
        message_queue.append(message)
        
        return jsonify({
            'status': 'success',
            'message_id': message_id_counter,
            'topic': message['topic']
        })
        
    except Exception as e:
        logger.error(f"Error publishing message: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/stream')
def get_messages():
    """Get messages from stream"""
    try:
        topic = request.args.get('topic')
        limit = request.args.get('limit', 100, type=int)
        
        if topic:
            messages = [msg for msg in message_queue if msg['topic'] == topic]
        else:
            messages = list(message_queue)
        
        recent_messages = messages[-limit:]
        
        return jsonify({
            'status': 'success',
            'messages': recent_messages,
            'count': len(recent_messages)
        })
        
    except Exception as e:
        logger.error(f"Error getting messages: {e}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@app.route('/api/stream/stats')
def get_stream_stats():
    """Get streaming statistics"""
    topics = set(msg['topic'] for msg in message_queue)
    
    return jsonify({
        'status': 'success',
        'data': {
            'total_messages': len(message_queue),
            'topics': list(topics),
            'queue_size': len(message_queue),
            'last_updated': datetime.now().isoformat()
        }
    })

@app.route('/metrics')
def metrics():
    """Prometheus metrics endpoint"""
    total_messages = len(message_queue)
    topics = set(msg['topic'] for msg in message_queue)
    
    metrics_text = f"""# HELP stream_messages_total Total number of messages
# TYPE stream_messages_total counter
stream_messages_total {total_messages}

# HELP stream_queue_size Current queue size
# TYPE stream_queue_size gauge
stream_queue_size {len(message_queue)}

# HELP stream_topics_count Number of active topics
# TYPE stream_topics_count gauge
stream_topics_count {len(topics)}
"""
    
    return metrics_text, 200, {'Content-Type': 'text/plain'}

if __name__ == '__main__':
    logger.info(f"Starting Simple Streaming Service on {HOST}:{PORT}")
    app.run(host=HOST, port=PORT, debug=False)
