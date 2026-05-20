
from flask import Flask, jsonify, request
import time
import random
import uuid

app = Flask(__name__)

# Rafiki/Mojaloop simulation data
participants = {}
quotes = {}
transfers = {}

class RafikiGateway:
    def __init__(self):
        self.participants = participants
        self.quotes = quotes
        self.transfers = transfers
        self.mojaloop_connected = True
        self.performance_stats = {
            "total_transfers": 0,
            "successful_transfers": 0,
            "failed_transfers": 0,
            "average_processing_time": 2.5
        }
        
    def create_quote(self, quote_data):
        """Create payment quote"""
        quote_id = str(uuid.uuid4())
        
        quote = {
            "quote_id": quote_id,
            "amount": quote_data["amount"],
            "currency": quote_data["currency"],
            "target_currency": quote_data.get("target_currency", "NGN"),
            "exchange_rate": 825.50 if quote_data["currency"] == "USD" else 1.0,
            "fees": quote_data["amount"] * 0.003,  # 0.3% fee
            "total_cost": quote_data["amount"] * 1.003,
            "expires_at": time.time() + 300,  # 5 minutes
            "created_at": time.time()
        }
        
        self.quotes[quote_id] = quote
        return quote
        
    def execute_transfer(self, transfer_data):
        """Execute Mojaloop transfer"""
        transfer_id = str(uuid.uuid4())
        
        # Simulate processing time
        processing_time = random.uniform(1.0, 4.0)
        time.sleep(0.1)  # Simulate some processing
        
        success_rate = 0.96  # 96% success rate
        is_successful = random.random() < success_rate
        
        transfer = {
            "transfer_id": transfer_id,
            "quote_id": transfer_data.get("quote_id"),
            "amount": transfer_data["amount"],
            "currency": transfer_data["currency"],
            "sender": transfer_data["sender"],
            "recipient": transfer_data["recipient"],
            "status": "completed" if is_successful else "failed",
            "processing_time": processing_time,
            "mojaloop_tx_id": str(uuid.uuid4()),
            "created_at": time.time()
        }
        
        self.transfers[transfer_id] = transfer
        self.performance_stats["total_transfers"] += 1
        
        if is_successful:
            self.performance_stats["successful_transfers"] += 1
        else:
            self.performance_stats["failed_transfers"] += 1
            
        return transfer

# Initialize Rafiki gateway
gateway = RafikiGateway()

@app.route('/health', methods=['GET'])
def health_check():
    """Proper JSON health endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "rafiki-gateway",
        "version": "v2.0.0",
        "mojaloop": "connected",
        "interledger": "ready",
        "performance": {
            "total_transfers": gateway.performance_stats["total_transfers"],
            "success_rate": f"{(gateway.performance_stats['successful_transfers'] / max(gateway.performance_stats['total_transfers'], 1) * 100):.1f}%",
            "average_processing_time": f"{gateway.performance_stats['average_processing_time']:.2f}s"
        },
        "timestamp": time.time()
    })

@app.route('/api/v1/quotes', methods=['POST'])
def create_quote():
    """Create payment quote"""
    try:
        quote_data = request.get_json()
        quote = gateway.create_quote(quote_data)
        return jsonify({"status": "success", "quote": quote})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/v1/transfers', methods=['POST'])
def execute_transfer():
    """Execute transfer via Mojaloop"""
    try:
        transfer_data = request.get_json()
        transfer = gateway.execute_transfer(transfer_data)
        return jsonify({"status": "success", "transfer": transfer})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/v1/transfers/<transfer_id>/status', methods=['GET'])
def get_transfer_status(transfer_id):
    """Get transfer status"""
    transfer = gateway.transfers.get(transfer_id)
    if not transfer:
        return jsonify({"status": "error", "message": "Transfer not found"}), 404
        
    return jsonify({"status": "success", "transfer": transfer})

if __name__ == '__main__':
    print("🚀 Starting Rafiki Gateway Service on port 3002...")
    app.run(host='0.0.0.0', port=3002, debug=False)
