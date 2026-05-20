import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from datetime import datetime, timedelta
import sqlite3
import hashlib
import jwt
import random
from decimal import Decimal

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'remittance-network-secret-key-2024'

# Enable CORS for all routes
CORS(app, origins="*")

# Database setup
DATABASE_PATH = os.path.join(os.path.dirname(__file__), 'database', 'remittance.db')

def init_database():
    """Initialize the database with tables and sample data"""
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            name TEXT NOT NULL,
            phone TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'active'
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS agents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            agent_code TEXT UNIQUE NOT NULL,
            location TEXT,
            tier TEXT,
            cash_balance DECIMAL(15,2) DEFAULT 0,
            commission DECIMAL(15,2) DEFAULT 0,
            customers_count INTEGER DEFAULT 0,
            transactions_count INTEGER DEFAULT 0,
            rating DECIMAL(3,2) DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            account_number TEXT UNIQUE NOT NULL,
            balance DECIMAL(15,2) DEFAULT 0,
            tier TEXT DEFAULT 'Bronze',
            kyc_status TEXT DEFAULT 'pending',
            agent_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (agent_id) REFERENCES agents (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_id TEXT UNIQUE NOT NULL,
            customer_id INTEGER,
            agent_id INTEGER,
            type TEXT NOT NULL,
            amount DECIMAL(15,2) NOT NULL,
            status TEXT DEFAULT 'pending',
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers (id),
            FOREIGN KEY (agent_id) REFERENCES agents (id)
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS system_stats (
            id INTEGER PRIMARY KEY,
            total_agents INTEGER DEFAULT 0,
            total_customers INTEGER DEFAULT 0,
            total_transactions INTEGER DEFAULT 0,
            total_volume DECIMAL(20,2) DEFAULT 0,
            active_agents INTEGER DEFAULT 0,
            online_agents INTEGER DEFAULT 0,
            fraud_alerts INTEGER DEFAULT 0,
            system_health DECIMAL(5,2) DEFAULT 100.0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Insert sample data if not exists
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        # Sample users
        sample_users = [
            ('aisha.mohammed@email.com', hashlib.sha256('password123'.encode()).hexdigest(), 'customer', 'Aisha Mohammed', '+234 803 123 4567'),
            ('michael.okafor@agentbank.com', hashlib.sha256('password123'.encode()).hexdigest(), 'agent', 'Michael Okafor', '+234 805 987 6543'),
            ('sarah.adebayo@agentbank.com', hashlib.sha256('password123'.encode()).hexdigest(), 'super_agent', 'Sarah Adebayo', '+234 807 555 1234'),
            ('admin@agentbank.com', hashlib.sha256('password123'.encode()).hexdigest(), 'admin', 'System Administrator', '+234 801 000 0000'),
        ]
        
        cursor.executemany(
            "INSERT INTO users (email, password_hash, role, name, phone) VALUES (?, ?, ?, ?, ?)",
            sample_users
        )
        
        # Sample agents
        cursor.execute("INSERT INTO agents (user_id, agent_code, location, tier, cash_balance, commission, customers_count, transactions_count, rating) VALUES (2, 'AG001', 'Lagos, Nigeria', 'Super Agent', 500000, 15750, 47, 156, 4.8)")
        cursor.execute("INSERT INTO agents (user_id, agent_code, location, tier, cash_balance, commission, customers_count, transactions_count, rating) VALUES (3, 'AG002', 'Abuja, Nigeria', 'Master Agent', 750000, 25400, 89, 234, 4.9)")
        
        # Sample customers
        cursor.execute("INSERT INTO customers (user_id, account_number, balance, tier, kyc_status, agent_id) VALUES (1, '1234567890', 125000, 'Gold', 'verified', 1)")
        
        # Sample transactions
        sample_transactions = [
            ('TXN001', 1, 1, 'deposit', 50000, 'completed', 'Cash deposit'),
            ('TXN002', 1, 1, 'withdrawal', 25000, 'completed', 'Cash withdrawal'),
            ('TXN003', 1, 1, 'transfer', 15000, 'pending', 'Transfer to another account'),
        ]
        
        cursor.executemany(
            "INSERT INTO transactions (transaction_id, customer_id, agent_id, type, amount, status, description) VALUES (?, ?, ?, ?, ?, ?, ?)",
            sample_transactions
        )
        
        # System stats
        cursor.execute("""
            INSERT INTO system_stats (id, total_agents, total_customers, total_transactions, total_volume, 
                                    active_agents, online_agents, fraud_alerts, system_health) 
            VALUES (1, 1247, 45678, 234567, 15678900000, 1156, 892, 12, 98.5)
        """)
    
    conn.commit()
    conn.close()

# Initialize database on startup
init_database()

# Authentication helper
def generate_token(user_data):
    """Generate JWT token for user"""
    payload = {
        'user_id': user_data['id'],
        'email': user_data['email'],
        'role': user_data['role'],
        'exp': datetime.utcnow() + timedelta(hours=24)
    }
    return jwt.encode(payload, app.config['SECRET_KEY'], algorithm='HS256')

def verify_token(token):
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, app.config['SECRET_KEY'], algorithms=['HS256'])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

# API Routes

@app.route('/api/auth/login', methods=['POST'])
def login():
    """User authentication endpoint"""
    data = request.get_json()
    email = data.get('email')
    password = data.get('password')
    role = data.get('role', 'customer')
    
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    password_hash = hashlib.sha256(password.encode()).hexdigest()
    cursor.execute(
        "SELECT * FROM users WHERE email = ? AND password_hash = ? AND role = ?",
        (email, password_hash, role)
    )
    
    user = cursor.fetchone()
    if not user:
        # For demo purposes, create a demo user if not found
        demo_user = {
            'id': random.randint(1000, 9999),
            'email': email,
            'role': role,
            'name': f'Demo {role.replace("_", " ").title()}',
            'phone': '+234 800 000 0000'
        }
        token = generate_token(demo_user)
        conn.close()
        return jsonify({
            'token': token,
            'user': demo_user,
            'message': 'Demo login successful'
        })
    
    user_data = dict(user)
    token = generate_token(user_data)
    
    # Get additional data based on role
    if role == 'agent' or role == 'super_agent':
        cursor.execute("SELECT * FROM agents WHERE user_id = ?", (user_data['id'],))
        agent_data = cursor.fetchone()
        if agent_data:
            user_data.update(dict(agent_data))
    elif role == 'customer':
        cursor.execute("SELECT * FROM customers WHERE user_id = ?", (user_data['id'],))
        customer_data = cursor.fetchone()
        if customer_data:
            user_data.update(dict(customer_data))
    
    conn.close()
    
    return jsonify({
        'token': token,
        'user': user_data,
        'message': 'Login successful'
    })

@app.route('/api/dashboard/stats', methods=['GET'])
def get_dashboard_stats():
    """Get dashboard statistics based on user role"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({'error': 'Authorization header required'}), 401
    
    token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    user_data = verify_token(token)
    
    if not user_data:
        return jsonify({'error': 'Invalid token'}), 401
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if user_data['role'] == 'admin':
        cursor.execute("SELECT * FROM system_stats WHERE id = 1")
        stats = dict(cursor.fetchone())
        conn.close()
        return jsonify(stats)
    
    elif user_data['role'] in ['agent', 'super_agent']:
        cursor.execute("SELECT * FROM agents WHERE user_id = ?", (user_data['user_id'],))
        agent_stats = dict(cursor.fetchone())
        conn.close()
        return jsonify(agent_stats)
    
    elif user_data['role'] == 'customer':
        cursor.execute("SELECT * FROM customers WHERE user_id = ?", (user_data['user_id'],))
        customer_stats = dict(cursor.fetchone())
        conn.close()
        return jsonify(customer_stats)
    
    conn.close()
    return jsonify({'error': 'Invalid role'}), 400

@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    """Get transactions for the authenticated user"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({'error': 'Authorization header required'}), 401
    
    token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    user_data = verify_token(token)
    
    if not user_data:
        return jsonify({'error': 'Invalid token'}), 401
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    if user_data['role'] == 'customer':
        cursor.execute("""
            SELECT t.*, a.agent_code, u.name as agent_name 
            FROM transactions t 
            JOIN agents a ON t.agent_id = a.id 
            JOIN users u ON a.user_id = u.id 
            WHERE t.customer_id = (SELECT id FROM customers WHERE user_id = ?)
            ORDER BY t.created_at DESC LIMIT 10
        """, (user_data['user_id'],))
    elif user_data['role'] in ['agent', 'super_agent']:
        cursor.execute("""
            SELECT t.*, c.account_number, u.name as customer_name 
            FROM transactions t 
            JOIN customers c ON t.customer_id = c.id 
            JOIN users u ON c.user_id = u.id 
            WHERE t.agent_id = (SELECT id FROM agents WHERE user_id = ?)
            ORDER BY t.created_at DESC LIMIT 20
        """, (user_data['user_id'],))
    else:
        cursor.execute("""
            SELECT t.*, c.account_number, u1.name as customer_name, 
                   a.agent_code, u2.name as agent_name 
            FROM transactions t 
            JOIN customers c ON t.customer_id = c.id 
            JOIN users u1 ON c.user_id = u1.id 
            JOIN agents a ON t.agent_id = a.id 
            JOIN users u2 ON a.user_id = u2.id 
            ORDER BY t.created_at DESC LIMIT 50
        """)
    
    transactions = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(transactions)

@app.route('/api/transactions', methods=['POST'])
def create_transaction():
    """Create a new transaction"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({'error': 'Authorization header required'}), 401
    
    token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    user_data = verify_token(token)
    
    if not user_data:
        return jsonify({'error': 'Invalid token'}), 401
    
    data = request.get_json()
    transaction_type = data.get('type')
    amount = data.get('amount')
    description = data.get('description', '')
    
    if not transaction_type or not amount:
        return jsonify({'error': 'Transaction type and amount required'}), 400
    
    conn = sqlite3.connect(DATABASE_PATH)
    cursor = conn.cursor()
    
    transaction_id = f"TXN{random.randint(100000, 999999)}"
    
    # For demo purposes, create a successful transaction
    cursor.execute("""
        INSERT INTO transactions (transaction_id, customer_id, agent_id, type, amount, status, description)
        VALUES (?, 1, 1, ?, ?, 'completed', ?)
    """, (transaction_id, transaction_type, amount, description))
    
    conn.commit()
    conn.close()
    
    return jsonify({
        'transaction_id': transaction_id,
        'status': 'completed',
        'message': 'Transaction processed successfully'
    })

@app.route('/api/agents', methods=['GET'])
def get_agents():
    """Get list of agents (admin only)"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({'error': 'Authorization header required'}), 401
    
    token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    user_data = verify_token(token)
    
    if not user_data or user_data['role'] != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT a.*, u.name, u.email, u.phone, u.status 
        FROM agents a 
        JOIN users u ON a.user_id = u.id 
        ORDER BY a.created_at DESC
    """)
    
    agents = [dict(row) for row in cursor.fetchall()]
    conn.close()
    
    return jsonify(agents)

@app.route('/api/system/health', methods=['GET'])
def get_system_health():
    """Get system health status"""
    return jsonify({
        'api_gateway': 'online',
        'database': 'online',
        'payment_processing': 'online',
        'fraud_detection': 'degraded',
        'timestamp': datetime.utcnow().isoformat()
    })

@app.route('/api/alerts', methods=['GET'])
def get_security_alerts():
    """Get security alerts (admin only)"""
    auth_header = request.headers.get('Authorization')
    if not auth_header:
        return jsonify({'error': 'Authorization header required'}), 401
    
    token = auth_header.split(' ')[1] if ' ' in auth_header else auth_header
    user_data = verify_token(token)
    
    if not user_data or user_data['role'] != 'admin':
        return jsonify({'error': 'Admin access required'}), 403
    
    # Mock security alerts
    alerts = [
        {
            'id': 1,
            'type': 'high_risk_transaction',
            'severity': 'high',
            'title': 'High-risk transaction detected',
            'description': 'Agent AG045 - ₦500,000 withdrawal',
            'timestamp': datetime.utcnow().isoformat()
        },
        {
            'id': 2,
            'type': 'unusual_activity',
            'severity': 'medium',
            'title': 'Unusual activity pattern',
            'description': 'Multiple failed login attempts',
            'timestamp': (datetime.utcnow() - timedelta(hours=2)).isoformat()
        }
    ]
    
    return jsonify(alerts)

# Serve frontend files
@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    static_folder_path = app.static_folder
    if static_folder_path is None:
        return "Static folder not configured", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, 'index.html')
        else:
            return jsonify({
                'message': 'Remittance Platform API',
                'version': '1.0.0',
                'endpoints': [
                    '/api/auth/login',
                    '/api/dashboard/stats',
                    '/api/transactions',
                    '/api/agents',
                    '/api/system/health',
                    '/api/alerts'
                ]
            })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

