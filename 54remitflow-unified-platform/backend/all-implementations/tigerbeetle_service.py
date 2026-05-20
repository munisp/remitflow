
from flask import Flask, jsonify, request
import time
import threading
import random

app = Flask(__name__)

# TigerBeetle simulation data
accounts_db = {}
transfers_db = {}
account_counter = 1000000
transfer_counter = 2000000

class TigerBeetleLedger:
    def __init__(self):
        self.accounts = accounts_db
        self.transfers = transfers_db
        self.performance_stats = {
            "total_accounts": 0,
            "total_transfers": 0,
            "tps_current": 0,
            "tps_peak": 0
        }
        
    def create_account(self, account_data):
        global account_counter
        account_id = account_counter
        account_counter += 1
        
        account = {
            "id": account_id,
            "user_id": account_data.get("user_id"),
            "currency": account_data.get("currency", "NGN"),
            "balance": 0,
            "created_at": time.time(),
            "status": "active"
        }
        
        self.accounts[account_id] = account
        self.performance_stats["total_accounts"] += 1
        return account
        
    def create_transfer(self, transfer_data):
        global transfer_counter
        transfer_id = transfer_counter
        transfer_counter += 1
        
        # Validate accounts exist
        debit_account = self.accounts.get(transfer_data["debit_account_id"])
        credit_account = self.accounts.get(transfer_data["credit_account_id"])
        
        if not debit_account or not credit_account:
            return {"error": "Account not found"}
            
        amount = transfer_data["amount"]
        
        # Check sufficient balance
        if debit_account["balance"] < amount:
            return {"error": "Insufficient balance"}
            
        # Execute transfer
        debit_account["balance"] -= amount
        credit_account["balance"] += amount
        
        transfer = {
            "id": transfer_id,
            "debit_account_id": transfer_data["debit_account_id"],
            "credit_account_id": transfer_data["credit_account_id"],
            "amount": amount,
            "currency": transfer_data.get("currency", "NGN"),
            "status": "completed",
            "created_at": time.time()
        }
        
        self.transfers[transfer_id] = transfer
        self.performance_stats["total_transfers"] += 1
        self.performance_stats["tps_current"] = min(self.performance_stats["tps_current"] + 1, 50000)
        self.performance_stats["tps_peak"] = max(self.performance_stats["tps_peak"], self.performance_stats["tps_current"])
        
        return transfer

# Initialize TigerBeetle ledger
ledger = TigerBeetleLedger()

@app.route('/health', methods=['GET'])
def health_check():
    """Proper JSON health endpoint"""
    return jsonify({
        "status": "healthy",
        "service": "tigerbeetle-ledger",
        "version": "v2.0.0",
        "accounts": "ready",
        "performance": {
            "total_accounts": ledger.performance_stats["total_accounts"],
            "total_transfers": ledger.performance_stats["total_transfers"],
            "current_tps": ledger.performance_stats["tps_current"],
            "peak_tps": ledger.performance_stats["tps_peak"]
        },
        "timestamp": time.time()
    })

@app.route('/api/v1/accounts', methods=['POST'])
def create_account():
    """Create new account"""
    try:
        account_data = request.get_json()
        account = ledger.create_account(account_data)
        return jsonify({"status": "success", "account": account})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/v1/transfers', methods=['POST'])
def create_transfer():
    """Create new transfer"""
    try:
        transfer_data = request.get_json()
        transfer = ledger.create_transfer(transfer_data)
        
        if "error" in transfer:
            return jsonify({"status": "error", "message": transfer["error"]}), 400
            
        return jsonify({"status": "success", "transfer": transfer})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500

@app.route('/api/v1/accounts/<int:account_id>/balance', methods=['GET'])
def get_balance(account_id):
    """Get account balance"""
    account = ledger.accounts.get(account_id)
    if not account:
        return jsonify({"status": "error", "message": "Account not found"}), 404
        
    return jsonify({
        "status": "success",
        "account_id": account_id,
        "balance": account["balance"],
        "currency": account["currency"]
    })

@app.route('/api/v1/performance', methods=['GET'])
def get_performance():
    """Get performance metrics"""
    return jsonify({
        "status": "success",
        "performance": ledger.performance_stats,
        "timestamp": time.time()
    })

if __name__ == '__main__':
    print("🚀 Starting TigerBeetle Ledger Service on port 3001...")
    app.run(host='0.0.0.0', port=3001, debug=False)
