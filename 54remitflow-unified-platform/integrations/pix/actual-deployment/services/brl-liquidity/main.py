#!/usr/bin/env python3
"""
BRL Liquidity Manager Service
Real-time exchange rates and liquidity management
"""


from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import time
import json
import random
from datetime import datetime

app = Flask(__name__)
CORS(app)

# Service start time
start_time = time.time()

# Simulated exchange rates (in production, would fetch from real APIs)
exchange_rates = {
    "NGN_BRL": 0.0067,
    "BRL_NGN": 149.25,
    "USD_BRL": 5.15,
    "BRL_USD": 0.194,
    "USDC_BRL": 5.14,
    "BRL_USDC": 0.195
}

# Simulated liquidity pools
liquidity_pools = {
    "BRL": {
        "total": 10000000.0,  # 10M BRL
        "available": 8500000.0,  # 8.5M BRL available
        "reserved": 1500000.0,   # 1.5M BRL reserved
        "utilization": 15.0      # 15% utilization
    },
    "NGN": {
        "total": 1500000000.0,  # 1.5B NGN
        "available": 1200000000.0,  # 1.2B NGN available
        "reserved": 300000000.0,    # 300M NGN reserved
        "utilization": 20.0         # 20% utilization
    },
    "USDC": {
        "total": 2000000.0,     # 2M USDC
        "available": 1800000.0,  # 1.8M USDC available
        "reserved": 200000.0,    # 200K USDC reserved
        "utilization": 10.0      # 10% utilization
    }
}

@app.route('/health', methods=['GET'])
def health():
    uptime = time.time() - start_time
    return jsonify({
        "success": True,
        "data": {
            "service": "BRL Liquidity Manager",
            "status": "healthy",
            "version": "1.0.0",
            "uptime": f"{uptime:.2f}s",
            "timestamp": datetime.now().isoformat(),
            "exchange_api_connected": True,
            "liquidity_pools_active": len(liquidity_pools)
        }
    })

@app.route('/api/v1/rates', methods=['GET'])
def get_exchange_rates():
    # Add small random fluctuation to simulate real market
    current_rates = {}
    for pair, rate in exchange_rates.items():
        fluctuation = random.uniform(-0.02, 0.02)  # ±2% fluctuation
        current_rates[pair] = round(rate * (1 + fluctuation), 6)
    
    return jsonify({
        "success": True,
        "data": {
            "rates": current_rates,
            "timestamp": datetime.now().isoformat(),
            "source": "Multiple exchanges",
            "last_updated": datetime.now().isoformat()
        }
    })

@app.route('/api/v1/liquidity', methods=['GET'])
def get_liquidity_status():
    return jsonify({
        "success": True,
        "data": {
            "pools": liquidity_pools,
            "timestamp": datetime.now().isoformat(),
            "total_value_usd": sum(pool["total"] for pool in liquidity_pools.values()) / 5.15
        }
    })

@app.route('/api/v1/convert', methods=['POST'])
def convert_currency():
    data = request.get_json()
    
    from_currency = data.get('from_currency')
    to_currency = data.get('to_currency')
    amount = data.get('amount', 0)
    
    # Find exchange rate
    rate_key = f"{from_currency}_{to_currency}"
    if rate_key in exchange_rates:
        rate = exchange_rates[rate_key]
        # Add small fluctuation
        fluctuation = random.uniform(-0.01, 0.01)
        actual_rate = rate * (1 + fluctuation)
        to_amount = amount * actual_rate
        
        conversion_id = f"CONV_{int(time.time())}"
        
        return jsonify({
            "success": True,
            "data": {
                "id": conversion_id,
                "from_currency": from_currency,
                "to_currency": to_currency,
                "from_amount": amount,
                "to_amount": round(to_amount, 2),
                "exchange_rate": round(actual_rate, 6),
                "timestamp": datetime.now().isoformat(),
                "expires_at": datetime.now().isoformat()
            }
        })
    else:
        return jsonify({
            "success": False,
            "error": f"Exchange rate not available for {from_currency} to {to_currency}"
        }), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5002))
    print(f"🚀 BRL Liquidity Manager starting on port {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
