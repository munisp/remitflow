#!/usr/bin/env python3
"""
TigerBeetle HTTP API Service
High-performance accounting engine HTTP wrapper for Remittance Platform
"""

import os
import json
import time
import uuid
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import threading
import queue
import sqlite3
from contextlib import contextmanager

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =====================================================
# DATA MODELS
# =====================================================

@dataclass
class Account:
    """TigerBeetle Account representation"""
    id: int
    user_data: int = 0
    code: int = 0
    debits_pending: int = 0
    debits_posted: int = 0
    credits_pending: int = 0
    credits_posted: int = 0
    timestamp: int = 0
    
    @property
    def balance(self) -> int:
        """Calculate account balance (credits - debits)"""
        return (self.credits_posted + self.credits_pending) - (self.debits_posted + self.debits_pending)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        result = asdict(self)
        result['balance'] = self.balance
        return result

@dataclass
class Transfer:
    """TigerBeetle Transfer representation"""
    id: int
    debit_account_id: int
    credit_account_id: int
    amount: int
    pending_id: int = 0
    user_data: int = 0
    timeout: int = 0
    ledger: int = 1
    code: int = 0
    flags: int = 0
    timestamp: int = 0
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return asdict(self)

# =====================================================
# TIGERBEETLE SIMULATOR
# =====================================================

class TigerBeetleSimulator:
    """
    High-performance TigerBeetle simulator using SQLite for persistence
    Simulates TigerBeetle's double-entry bookkeeping with ACID guarantees
    """
    
    def __init__(self, db_path: str = "/tmp/tigerbeetle_sim.db"):
        self.db_path = db_path
        # Remove in-memory caching to ensure database consistency across workers
        self.lock = threading.RLock()
        self._init_database()
        
        # Performance metrics
        self.metrics = {
            'accounts_created': 0,
            'transfers_processed': 0,
            'balance_queries': 0,
            'errors': 0,
            'start_time': time.time()
        }
        logger.info("TigerBeetle Simulator initialized")
    
    def _init_database(self):
        """Initialize SQLite database for persistence"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS accounts (
                    id INTEGER PRIMARY KEY,
                    user_data INTEGER DEFAULT 0,
                    code INTEGER DEFAULT 0,
                    debits_pending INTEGER DEFAULT 0,
                    debits_posted INTEGER DEFAULT 0,
                    credits_pending INTEGER DEFAULT 0,
                    credits_posted INTEGER DEFAULT 0,
                    timestamp INTEGER DEFAULT 0
                )
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS transfers (
                    id INTEGER PRIMARY KEY,
                    debit_account_id INTEGER NOT NULL,
                    credit_account_id INTEGER NOT NULL,
                    amount INTEGER NOT NULL,
                    pending_id INTEGER DEFAULT 0,
                    user_data INTEGER DEFAULT 0,
                    timeout INTEGER DEFAULT 0,
                    ledger INTEGER DEFAULT 1,
                    code INTEGER DEFAULT 0,
                    flags INTEGER DEFAULT 0,
                    timestamp INTEGER DEFAULT 0,
                    FOREIGN KEY (debit_account_id) REFERENCES accounts (id),
                    FOREIGN KEY (credit_account_id) REFERENCES accounts (id)
                )
            """)
            
            # Create indexes for performance
            conn.execute("CREATE INDEX IF NOT EXISTS idx_accounts_code ON accounts (code)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_transfers_debit ON transfers (debit_account_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_transfers_credit ON transfers (credit_account_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_transfers_timestamp ON transfers (timestamp)")
            
            conn.commit()
    
    def _load_data(self):
        """Load existing data from database"""
        with sqlite3.connect(self.db_path) as conn:
            # Load accounts
            cursor = conn.execute("SELECT * FROM accounts")
            for row in cursor.fetchall():
                account = Account(
                    id=row[0], user_data=row[1], code=row[2],
                    debits_pending=row[3], debits_posted=row[4],
                    credits_pending=row[5], credits_posted=row[6],
                    timestamp=row[7]
                )
                self.accounts[account.id] = account
            
            # Load transfers
            cursor = conn.execute("SELECT * FROM transfers")
            for row in cursor.fetchall():
                transfer = Transfer(
                    id=row[0], debit_account_id=row[1], credit_account_id=row[2],
                    amount=row[3], pending_id=row[4], user_data=row[5],
                    timeout=row[6], ledger=row[7], code=row[8],
                    flags=row[9], timestamp=row[10]
                )
                self.transfers[transfer.id] = transfer
        
        logger.info(f"Loaded {len(self.accounts)} accounts and {len(self.transfers)} transfers")
    
    def create_account(self, account_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new account"""
        try:
            with self.lock:
                account_id = account_data['id']
                
                # Check if account already exists
                with sqlite3.connect(self.db_path) as conn:
                    cursor = conn.execute("SELECT id FROM accounts WHERE id = ?", (account_id,))
                    if cursor.fetchone():
                        return {
                            'success': False,
                            'error': f'Account {account_id} already exists',
                            'code': 'account_exists'
                        }
                
                # Create account
                account = Account(
                    id=account_id,
                    user_data=account_data.get('user_data', 0),
                    code=account_data.get('code', 0),
                    timestamp=int(time.time() * 1_000_000)  # Microseconds
                )
                
                # Save to database
                with sqlite3.connect(self.db_path) as conn:
                    conn.execute("""
                        INSERT INTO accounts (id, user_data, code, timestamp)
                        VALUES (?, ?, ?, ?)
                    """, (account.id, account.user_data, account.code, account.timestamp))
                    conn.commit()
                
                self.metrics['accounts_created'] += 1
                
                return {
                    'success': True,
                    'account': account.to_dict()
                }
                
        except Exception as e:
            self.metrics['errors'] += 1
            logger.error(f"Error creating account {account_data.get('id')}: {e}")
            return {
                'success': False,
                'error': str(e),
                'code': 'internal_error'
            }
    
    def create_transfer(self, transfer_data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new transfer (double-entry transaction)"""
        try:
            with self.lock:
                transfer_id = transfer_data['id']
                debit_account_id = transfer_data['debit_account_id']
                credit_account_id = transfer_data['credit_account_id']
                amount = transfer_data['amount']
                
                # Check if transfer already exists
                with sqlite3.connect(self.db_path) as conn:
                    cursor = conn.execute("SELECT id FROM transfers WHERE id = ?", (transfer_id,))
                    if cursor.fetchone():
                        return {
                            'success': False,
                            'error': f'Transfer {transfer_id} already exists',
                            'code': 'transfer_exists'
                        }
                
                # Validate accounts exist
                with sqlite3.connect(self.db_path) as conn:
                    cursor = conn.execute("SELECT id FROM accounts WHERE id = ?", (debit_account_id,))
                    if not cursor.fetchone():
                        return {
                            'success': False,
                            'error': f'Debit account {debit_account_id} does not exist',
                            'code': 'account_not_found'
                        }
                    
                    cursor = conn.execute("SELECT id FROM accounts WHERE id = ?", (credit_account_id,))
                    if not cursor.fetchone():
                        return {
                            'success': False,
                            'error': f'Credit account {credit_account_id} does not exist',
                            'code': 'account_not_found'
                        }
                
                # Validate amount
                if amount <= 0:
                    return {
                        'success': False,
                        'error': 'Amount must be positive',
                        'code': 'invalid_amount'
                    }
                
                # Create transfer
                transfer = Transfer(
                    id=transfer_id,
                    debit_account_id=debit_account_id,
                    credit_account_id=credit_account_id,
                    amount=amount,
                    pending_id=transfer_data.get('pending_id', 0),
                    user_data=transfer_data.get('user_data', 0),
                    timeout=transfer_data.get('timeout', 0),
                    ledger=transfer_data.get('ledger', 1),
                    code=transfer_data.get('code', 0),
                    flags=transfer_data.get('flags', 0),
                    timestamp=int(time.time() * 1_000_000)
                )
                
                # Save to database (atomic transaction)
                with sqlite3.connect(self.db_path) as conn:
                    # Insert transfer
                    conn.execute("""
                        INSERT INTO transfers 
                        (id, debit_account_id, credit_account_id, amount, pending_id, 
                         user_data, timeout, ledger, code, flags, timestamp)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        transfer.id, transfer.debit_account_id, transfer.credit_account_id,
                        transfer.amount, transfer.pending_id, transfer.user_data,
                        transfer.timeout, transfer.ledger, transfer.code,
                        transfer.flags, transfer.timestamp
                    ))
                    
                    # Update debit account
                    conn.execute("""
                        UPDATE accounts SET debits_posted = debits_posted + ? WHERE id = ?
                    """, (amount, debit_account_id))
                    
                    # Update credit account
                    conn.execute("""
                        UPDATE accounts SET credits_posted = credits_posted + ? WHERE id = ?
                    """, (amount, credit_account_id))
                    
                    conn.commit()
                
                self.metrics['transfers_processed'] += 1
                
                return {
                    'success': True,
                    'transfer': transfer.to_dict()
                }
                
        except Exception as e:
            self.metrics['errors'] += 1
            logger.error(f"Error creating transfer {transfer_data.get('id')}: {e}")
            return {
                'success': False,
                'error': str(e),
                'code': 'internal_error'
            }
    
    def get_account(self, account_id: int) -> Optional[Dict[str, Any]]:
        """Get account by ID"""
        try:
            with self.lock:
                self.metrics['balance_queries'] += 1
                
                with sqlite3.connect(self.db_path) as conn:
                    cursor = conn.execute("SELECT * FROM accounts WHERE id = ?", (account_id,))
                    row = cursor.fetchone()
                    
                    if row:
                        account = Account(
                            id=row[0], user_data=row[1], code=row[2],
                            debits_pending=row[3], debits_posted=row[4],
                            credits_pending=row[5], credits_posted=row[6],
                            timestamp=row[7]
                        )
                        return account.to_dict()
                    
                    return None
                
        except Exception as e:
            self.metrics['errors'] += 1
            logger.error(f"Error getting account {account_id}: {e}")
            return None
    
    def get_account_balance(self, account_id: int) -> Optional[Dict[str, Any]]:
        """Get account balance"""
        account = self.get_account(account_id)
        if account:
            return {
                'account_id': account_id,
                'balance': account['balance'],
                'debits_posted': account['debits_posted'],
                'credits_posted': account['credits_posted'],
                'debits_pending': account['debits_pending'],
                'credits_pending': account['credits_pending']
            }
        return None
    
    def get_transfers(self, account_id: Optional[int] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Get transfers for an account or all transfers"""
        try:
            with self.lock:
                transfers = []
                
                for transfer in self.transfers.values():
                    if account_id is None or transfer.debit_account_id == account_id or transfer.credit_account_id == account_id:
                        transfers.append(transfer.to_dict())
                    
                    if len(transfers) >= limit:
                        break
                
                # Sort by timestamp (newest first)
                transfers.sort(key=lambda x: x['timestamp'], reverse=True)
                return transfers
                
        except Exception as e:
            self.metrics['errors'] += 1
            logger.error(f"Error getting transfers: {e}")
            return []
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get performance metrics"""
        uptime = time.time() - self.metrics['start_time']
        
        return {
            'accounts_created': self.metrics['accounts_created'],
            'transfers_processed': self.metrics['transfers_processed'],
            'balance_queries': self.metrics['balance_queries'],
            'errors': self.metrics['errors'],
            'uptime_seconds': uptime,
            'accounts_per_second': self.metrics['accounts_created'] / uptime if uptime > 0 else 0,
            'transfers_per_second': self.metrics['transfers_processed'] / uptime if uptime > 0 else 0,
            'total_accounts': len(self.accounts),
            'total_transfers': len(self.transfers)
        }

# =====================================================
# FLASK APPLICATION
# =====================================================

# Initialize Flask app
app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Initialize TigerBeetle simulator
tigerbeetle = TigerBeetleSimulator()

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'tigerbeetle-api',
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'version': '1.0.0'
    })

@app.route('/metrics', methods=['GET'])
def get_metrics():
    """Get performance metrics"""
    return jsonify(tigerbeetle.get_metrics())

@app.route('/accounts', methods=['POST'])
def create_account():
    """Create a new account"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided',
                'code': 'invalid_request'
            }), 400
        
        # Validate required fields
        if 'id' not in data:
            return jsonify({
                'success': False,
                'error': 'Account ID is required',
                'code': 'missing_field'
            }), 400
        
        result = tigerbeetle.create_account(data)
        
        if result['success']:
            return jsonify(result), 201
        else:
            status_code = 409 if result.get('code') == 'account_exists' else 400
            return jsonify(result), status_code
            
    except Exception as e:
        logger.error(f"Error in create_account: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/accounts/<int:account_id>', methods=['GET'])
def get_account(account_id: int):
    """Get account by ID"""
    try:
        account = tigerbeetle.get_account(account_id)
        
        if account:
            return jsonify({
                'success': True,
                'account': account
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Account {account_id} not found',
                'code': 'account_not_found'
            }), 404
            
    except Exception as e:
        logger.error(f"Error in get_account: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/accounts/<int:account_id>/balance', methods=['GET'])
def get_account_balance(account_id: int):
    """Get account balance"""
    try:
        balance = tigerbeetle.get_account_balance(account_id)
        
        if balance:
            return jsonify({
                'success': True,
                'balance': balance
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Account {account_id} not found',
                'code': 'account_not_found'
            }), 404
            
    except Exception as e:
        logger.error(f"Error in get_account_balance: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/transfers', methods=['POST'])
def create_transfer():
    """Create a new transfer"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No JSON data provided',
                'code': 'invalid_request'
            }), 400
        
        # Validate required fields
        required_fields = ['id', 'debit_account_id', 'credit_account_id', 'amount']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'{field} is required',
                    'code': 'missing_field'
                }), 400
        
        result = tigerbeetle.create_transfer(data)
        
        if result['success']:
            return jsonify(result), 201
        else:
            status_code = 409 if result.get('code') == 'transfer_exists' else 400
            return jsonify(result), status_code
            
    except Exception as e:
        logger.error(f"Error in create_transfer: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/transfers', methods=['GET'])
def get_transfers():
    """Get transfers"""
    try:
        account_id = request.args.get('account_id', type=int)
        limit = request.args.get('limit', default=100, type=int)
        
        # Limit the maximum number of transfers returned
        limit = min(limit, 1000)
        
        transfers = tigerbeetle.get_transfers(account_id, limit)
        
        return jsonify({
            'success': True,
            'transfers': transfers,
            'count': len(transfers)
        })
        
    except Exception as e:
        logger.error(f"Error in get_transfers: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/transfers/<int:transfer_id>', methods=['GET'])
def get_transfer(transfer_id: int):
    """Get transfer by ID"""
    try:
        if transfer_id in tigerbeetle.transfers:
            transfer = tigerbeetle.transfers[transfer_id]
            return jsonify({
                'success': True,
                'transfer': transfer.to_dict()
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Transfer {transfer_id} not found',
                'code': 'transfer_not_found'
            }), 404
            
    except Exception as e:
        logger.error(f"Error in get_transfer: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/accounts/batch', methods=['POST'])
def create_accounts_batch():
    """Create multiple accounts in batch"""
    try:
        data = request.get_json()
        
        if not data or 'accounts' not in data:
            return jsonify({
                'success': False,
                'error': 'Accounts array is required',
                'code': 'invalid_request'
            }), 400
        
        accounts = data['accounts']
        results = []
        
        for account_data in accounts:
            result = tigerbeetle.create_account(account_data)
            results.append(result)
        
        successful = sum(1 for r in results if r['success'])
        
        return jsonify({
            'success': True,
            'results': results,
            'total': len(results),
            'successful': successful,
            'failed': len(results) - successful
        })
        
    except Exception as e:
        logger.error(f"Error in create_accounts_batch: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.route('/transfers/batch', methods=['POST'])
def create_transfers_batch():
    """Create multiple transfers in batch"""
    try:
        data = request.get_json()
        
        if not data or 'transfers' not in data:
            return jsonify({
                'success': False,
                'error': 'Transfers array is required',
                'code': 'invalid_request'
            }), 400
        
        transfers = data['transfers']
        results = []
        
        for transfer_data in transfers:
            result = tigerbeetle.create_transfer(transfer_data)
            results.append(result)
        
        successful = sum(1 for r in results if r['success'])
        
        return jsonify({
            'success': True,
            'results': results,
            'total': len(results),
            'successful': successful,
            'failed': len(results) - successful
        })
        
    except Exception as e:
        logger.error(f"Error in create_transfers_batch: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal server error',
            'code': 'internal_error'
        }), 500

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({
        'success': False,
        'error': 'Endpoint not found',
        'code': 'not_found'
    }), 404

@app.errorhandler(405)
def method_not_allowed(error):
    """Handle 405 errors"""
    return jsonify({
        'success': False,
        'error': 'Method not allowed',
        'code': 'method_not_allowed'
    }), 405

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({
        'success': False,
        'error': 'Internal server error',
        'code': 'internal_error'
    }), 500

if __name__ == '__main__':
    # Get configuration from environment
    host = os.getenv('HOST', os.getenv('HOST', '0.0.0.0'))
    port = int(os.getenv('PORT', 8081))
    debug = os.getenv('DEBUG', 'false').lower() == 'true'
    
    logger.info(f"Starting TigerBeetle API service on {host}:{port}")
    logger.info(f"Debug mode: {debug}")
    
    # Run the Flask application
    app.run(
        host=host,
        port=port,
        debug=debug,
        threaded=True
    )

