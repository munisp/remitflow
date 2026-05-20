"""
Mojaloop PostgreSQL Integration
Complete database persistence layer for Mojaloop hub operations
"""

import psycopg2
from psycopg2 import pool, extras
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Any
import logging
import json
import os
import uuid

logger = logging.getLogger(__name__)


class MojaloopPostgresIntegration:
    """PostgreSQL integration for Mojaloop operations"""
    
    def __init__(self, database_url: str = None):
        """Initialize PostgreSQL connection pool"""
        self.database_url = database_url or os.getenv('DATABASE_URL')
        self.connection_pool = None
        self._initialize_connection_pool()
        self._initialize_schema()
    
    def _initialize_connection_pool(self):
        """Initialize PostgreSQL connection pool"""
        try:
            self.connection_pool = psycopg2.pool.ThreadedConnectionPool(
                minconn=5,
                maxconn=20,
                dsn=self.database_url
            )
            logger.info("Mojaloop PostgreSQL connection pool initialized")
        except Exception as e:
            logger.error(f"Failed to initialize connection pool: {e}")
            raise
    
    def _get_connection(self):
        """Get connection from pool"""
        return self.connection_pool.getconn()
    
    def _return_connection(self, conn):
        """Return connection to pool"""
        self.connection_pool.putconn(conn)
    
    def _initialize_schema(self):
        """Initialize Mojaloop database schema"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            # Create participants table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_participants (
                    id SERIAL PRIMARY KEY,
                    participant_id VARCHAR(100) UNIQUE NOT NULL,
                    name VARCHAR(200) NOT NULL,
                    type VARCHAR(50) NOT NULL DEFAULT 'DFSP',
                    currency VARCHAR(3) NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
                    tigerbeetle_account_id BIGINT,
                    endpoints JSONB,
                    capabilities JSONB,
                    settlement_model VARCHAR(50) DEFAULT 'DEFERRED_NET',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    metadata JSONB
                );
                
                CREATE INDEX IF NOT EXISTS idx_participant_id ON mojaloop_participants(participant_id);
                CREATE INDEX IF NOT EXISTS idx_participant_status ON mojaloop_participants(status);
                CREATE INDEX IF NOT EXISTS idx_participant_currency ON mojaloop_participants(currency);
            """)
            
            # Create quotes table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_quotes (
                    id SERIAL PRIMARY KEY,
                    quote_id VARCHAR(100) UNIQUE NOT NULL,
                    transaction_id VARCHAR(100) NOT NULL,
                    payer_fsp VARCHAR(100) NOT NULL,
                    payee_fsp VARCHAR(100) NOT NULL,
                    amount_type VARCHAR(20) DEFAULT 'SEND',
                    amount DECIMAL(20, 2) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    fees DECIMAL(20, 2) DEFAULT 0,
                    commission DECIMAL(20, 2) DEFAULT 0,
                    transfer_amount DECIMAL(20, 2),
                    exchange_rate DECIMAL(20, 6),
                    expiration TIMESTAMP,
                    geo_code VARCHAR(100),
                    note TEXT,
                    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (payer_fsp) REFERENCES mojaloop_participants(participant_id),
                    FOREIGN KEY (payee_fsp) REFERENCES mojaloop_participants(participant_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_quote_id ON mojaloop_quotes(quote_id);
                CREATE INDEX IF NOT EXISTS idx_quote_transaction_id ON mojaloop_quotes(transaction_id);
                CREATE INDEX IF NOT EXISTS idx_quote_status ON mojaloop_quotes(status);
                CREATE INDEX IF NOT EXISTS idx_quote_created_at ON mojaloop_quotes(created_at);
            """)
            
            # Create transfers table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_transfers (
                    id SERIAL PRIMARY KEY,
                    transfer_id VARCHAR(100) UNIQUE NOT NULL,
                    quote_id VARCHAR(100),
                    payer_fsp VARCHAR(100) NOT NULL,
                    payee_fsp VARCHAR(100) NOT NULL,
                    amount DECIMAL(20, 2) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    condition VARCHAR(200),
                    fulfillment VARCHAR(200),
                    expiration TIMESTAMP,
                    transfer_state VARCHAR(50) NOT NULL DEFAULT 'RECEIVED',
                    tigerbeetle_transfer_id BIGINT,
                    settlement_window_id VARCHAR(100),
                    extensions JSONB,
                    error_information JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP,
                    FOREIGN KEY (payer_fsp) REFERENCES mojaloop_participants(participant_id),
                    FOREIGN KEY (payee_fsp) REFERENCES mojaloop_participants(participant_id),
                    FOREIGN KEY (quote_id) REFERENCES mojaloop_quotes(quote_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_transfer_id ON mojaloop_transfers(transfer_id);
                CREATE INDEX IF NOT EXISTS idx_transfer_quote_id ON mojaloop_transfers(quote_id);
                CREATE INDEX IF NOT EXISTS idx_transfer_state ON mojaloop_transfers(transfer_state);
                CREATE INDEX IF NOT EXISTS idx_transfer_created_at ON mojaloop_transfers(created_at);
                CREATE INDEX IF NOT EXISTS idx_transfer_settlement_window ON mojaloop_transfers(settlement_window_id);
            """)
            
            # Create settlements table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_settlements (
                    id SERIAL PRIMARY KEY,
                    settlement_id VARCHAR(100) UNIQUE NOT NULL,
                    settlement_window_id VARCHAR(100) NOT NULL,
                    state VARCHAR(50) NOT NULL DEFAULT 'PENDING',
                    reason VARCHAR(200),
                    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_date TIMESTAMP,
                    settlement_windows JSONB,
                    participants JSONB,
                    metadata JSONB
                );
                
                CREATE INDEX IF NOT EXISTS idx_settlement_id ON mojaloop_settlements(settlement_id);
                CREATE INDEX IF NOT EXISTS idx_settlement_window_id ON mojaloop_settlements(settlement_window_id);
                CREATE INDEX IF NOT EXISTS idx_settlement_state ON mojaloop_settlements(state);
            """)
            
            # Create settlement windows table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_settlement_windows (
                    id SERIAL PRIMARY KEY,
                    settlement_window_id VARCHAR(100) UNIQUE NOT NULL,
                    state VARCHAR(50) NOT NULL DEFAULT 'OPEN',
                    reason VARCHAR(200),
                    created_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    changed_date TIMESTAMP,
                    content JSONB
                );
                
                CREATE INDEX IF NOT EXISTS idx_settlement_window_id ON mojaloop_settlement_windows(settlement_window_id);
                CREATE INDEX IF NOT EXISTS idx_settlement_window_state ON mojaloop_settlement_windows(state);
            """)
            
            # Create positions table (for settlement calculations)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_positions (
                    id SERIAL PRIMARY KEY,
                    participant_id VARCHAR(100) NOT NULL,
                    currency VARCHAR(3) NOT NULL,
                    position DECIMAL(20, 2) DEFAULT 0,
                    reserved_position DECIMAL(20, 2) DEFAULT 0,
                    settlement_window_id VARCHAR(100),
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (participant_id) REFERENCES mojaloop_participants(participant_id),
                    UNIQUE(participant_id, currency, settlement_window_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_position_participant ON mojaloop_positions(participant_id);
                CREATE INDEX IF NOT EXISTS idx_position_window ON mojaloop_positions(settlement_window_id);
            """)
            
            # Create audit trail table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_audit_trail (
                    id SERIAL PRIMARY KEY,
                    entity_type VARCHAR(50) NOT NULL,
                    entity_id VARCHAR(100) NOT NULL,
                    action VARCHAR(100) NOT NULL,
                    actor VARCHAR(200),
                    old_state JSONB,
                    new_state JSONB,
                    details JSONB,
                    ip_address VARCHAR(50),
                    user_agent TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                
                CREATE INDEX IF NOT EXISTS idx_audit_entity ON mojaloop_audit_trail(entity_type, entity_id);
                CREATE INDEX IF NOT EXISTS idx_audit_created_at ON mojaloop_audit_trail(created_at);
            """)
            
            # Create statistics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_statistics (
                    id SERIAL PRIMARY KEY,
                    date DATE NOT NULL,
                    participant_id VARCHAR(100),
                    currency VARCHAR(3),
                    total_quotes INTEGER DEFAULT 0,
                    total_transfers INTEGER DEFAULT 0,
                    total_amount DECIMAL(20, 2) DEFAULT 0,
                    successful_transfers INTEGER DEFAULT 0,
                    failed_transfers INTEGER DEFAULT 0,
                    avg_processing_time_ms INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(date, participant_id, currency)
                );
                
                CREATE INDEX IF NOT EXISTS idx_stats_date ON mojaloop_statistics(date);
                CREATE INDEX IF NOT EXISTS idx_stats_participant ON mojaloop_statistics(participant_id);
            """)
            
            # Create payment system integrations table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS mojaloop_payment_system_integrations (
                    id SERIAL PRIMARY KEY,
                    system_name VARCHAR(50) NOT NULL,
                    system_type VARCHAR(50) NOT NULL,
                    participant_id VARCHAR(100),
                    configuration JSONB,
                    status VARCHAR(50) DEFAULT 'ACTIVE',
                    last_health_check TIMESTAMP,
                    health_status VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (participant_id) REFERENCES mojaloop_participants(participant_id)
                );
                
                CREATE INDEX IF NOT EXISTS idx_integration_system ON mojaloop_payment_system_integrations(system_name);
                CREATE INDEX IF NOT EXISTS idx_integration_participant ON mojaloop_payment_system_integrations(participant_id);
            """)
            
            conn.commit()
            logger.info("Mojaloop database schema initialized successfully")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to initialize schema: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Participant operations
    def create_participant(self, participant_data: Dict[str, Any]) -> int:
        """Create a new Mojaloop participant"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_participants (
                    participant_id, name, type, currency, status, tigerbeetle_account_id,
                    endpoints, capabilities, settlement_model, metadata
                ) VALUES (
                    %(participant_id)s, %(name)s, %(type)s, %(currency)s, %(status)s,
                    %(tigerbeetle_account_id)s, %(endpoints)s, %(capabilities)s,
                    %(settlement_model)s, %(metadata)s
                ) RETURNING id
            """, participant_data)
            
            participant_id = cursor.fetchone()[0]
            conn.commit()
            
            self._log_audit_trail('participant', participant_data['participant_id'], 'created', participant_data)
            logger.info(f"Participant created: {participant_data['participant_id']}")
            return participant_id
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to create participant: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def get_participant(self, participant_id: str) -> Optional[Dict[str, Any]]:
        """Get participant by ID"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor(cursor_factory=extras.RealDictCursor)
            cursor.execute(
                "SELECT * FROM mojaloop_participants WHERE participant_id = %s",
                (participant_id,)
            )
            result = cursor.fetchone()
            return dict(result) if result else None
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Quote operations
    def create_quote(self, quote_data: Dict[str, Any]) -> int:
        """Create a new quote"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_quotes (
                    quote_id, transaction_id, payer_fsp, payee_fsp, amount_type,
                    amount, currency, fees, commission, transfer_amount, exchange_rate,
                    expiration, geo_code, note, status
                ) VALUES (
                    %(quote_id)s, %(transaction_id)s, %(payer_fsp)s, %(payee_fsp)s,
                    %(amount_type)s, %(amount)s, %(currency)s, %(fees)s, %(commission)s,
                    %(transfer_amount)s, %(exchange_rate)s, %(expiration)s, %(geo_code)s,
                    %(note)s, %(status)s
                ) RETURNING id
            """, quote_data)
            
            quote_id = cursor.fetchone()[0]
            conn.commit()
            
            self._log_audit_trail('quote', quote_data['quote_id'], 'created', quote_data)
            logger.info(f"Quote created: {quote_data['quote_id']}")
            return quote_id
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to create quote: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def update_quote_status(self, quote_id: str, status: str):
        """Update quote status"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE mojaloop_quotes
                SET status = %s, updated_at = CURRENT_TIMESTAMP
                WHERE quote_id = %s
            """, (status, quote_id))
            conn.commit()
            
            self._log_audit_trail('quote', quote_id, f'status_changed_to_{status}', {'status': status})
            logger.info(f"Quote {quote_id} status updated to {status}")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to update quote status: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def get_quote(self, quote_id: str) -> Optional[Dict[str, Any]]:
        """Get quote by ID"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor(cursor_factory=extras.RealDictCursor)
            cursor.execute("SELECT * FROM mojaloop_quotes WHERE quote_id = %s", (quote_id,))
            result = cursor.fetchone()
            return dict(result) if result else None
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Transfer operations
    def create_transfer(self, transfer_data: Dict[str, Any]) -> int:
        """Create a new transfer"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_transfers (
                    transfer_id, quote_id, payer_fsp, payee_fsp, amount, currency,
                    condition, expiration, transfer_state, tigerbeetle_transfer_id,
                    settlement_window_id, extensions
                ) VALUES (
                    %(transfer_id)s, %(quote_id)s, %(payer_fsp)s, %(payee_fsp)s,
                    %(amount)s, %(currency)s, %(condition)s, %(expiration)s,
                    %(transfer_state)s, %(tigerbeetle_transfer_id)s, %(settlement_window_id)s,
                    %(extensions)s
                ) RETURNING id
            """, transfer_data)
            
            transfer_id = cursor.fetchone()[0]
            conn.commit()
            
            self._log_audit_trail('transfer', transfer_data['transfer_id'], 'created', transfer_data)
            logger.info(f"Transfer created: {transfer_data['transfer_id']}")
            return transfer_id
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to create transfer: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def update_transfer_state(self, transfer_id: str, state: str, fulfillment: str = None, error_info: Dict = None):
        """Update transfer state"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            
            update_data = {
                'state': state,
                'transfer_id': transfer_id,
                'fulfillment': fulfillment,
                'error_information': json.dumps(error_info) if error_info else None,
                'completed_at': datetime.now() if state in ['COMMITTED', 'ABORTED'] else None
            }
            
            cursor.execute("""
                UPDATE mojaloop_transfers
                SET transfer_state = %(state)s,
                    fulfillment = %(fulfillment)s,
                    error_information = %(error_information)s,
                    completed_at = %(completed_at)s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE transfer_id = %(transfer_id)s
            """, update_data)
            
            conn.commit()
            
            self._log_audit_trail('transfer', transfer_id, f'state_changed_to_{state}', update_data)
            logger.info(f"Transfer {transfer_id} state updated to {state}")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to update transfer state: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def get_transfer(self, transfer_id: str) -> Optional[Dict[str, Any]]:
        """Get transfer by ID"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor(cursor_factory=extras.RealDictCursor)
            cursor.execute("SELECT * FROM mojaloop_transfers WHERE transfer_id = %s", (transfer_id,))
            result = cursor.fetchone()
            return dict(result) if result else None
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Payment system integration operations
    def register_payment_system(self, system_data: Dict[str, Any]) -> int:
        """Register a payment system integration (PAPSS, PIX, CIPS, UPI)"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_payment_system_integrations (
                    system_name, system_type, participant_id, configuration, status
                ) VALUES (
                    %(system_name)s, %(system_type)s, %(participant_id)s,
                    %(configuration)s, %(status)s
                ) RETURNING id
            """, system_data)
            
            system_id = cursor.fetchone()[0]
            conn.commit()
            
            logger.info(f"Payment system registered: {system_data['system_name']}")
            return system_id
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to register payment system: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def get_payment_system_integrations(self) -> List[Dict[str, Any]]:
        """Get all payment system integrations"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor(cursor_factory=extras.RealDictCursor)
            cursor.execute("SELECT * FROM mojaloop_payment_system_integrations WHERE status = 'ACTIVE'")
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Settlement operations
    def create_settlement_window(self, window_id: str) -> int:
        """Create a new settlement window"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_settlement_windows (settlement_window_id, state)
                VALUES (%s, 'OPEN')
                RETURNING id
            """, (window_id,))
            
            window_id_pk = cursor.fetchone()[0]
            conn.commit()
            logger.info(f"Settlement window created: {window_id}")
            return window_id_pk
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to create settlement window: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def close_settlement_window(self, window_id: str):
        """Close a settlement window"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE mojaloop_settlement_windows
                SET state = 'CLOSED', changed_date = CURRENT_TIMESTAMP
                WHERE settlement_window_id = %s
            """, (window_id,))
            conn.commit()
            logger.info(f"Settlement window closed: {window_id}")
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to close settlement window: {e}")
            raise
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Statistics
    def get_statistics(self, start_date: datetime, end_date: datetime, participant_id: str = None) -> List[Dict[str, Any]]:
        """Get statistics for date range"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor(cursor_factory=extras.RealDictCursor)
            
            query = "SELECT * FROM mojaloop_statistics WHERE date BETWEEN %s AND %s"
            params = [start_date, end_date]
            
            if participant_id:
                query += " AND participant_id = %s"
                params.append(participant_id)
            
            query += " ORDER BY date DESC"
            
            cursor.execute(query, params)
            return [dict(row) for row in cursor.fetchall()]
        finally:
            cursor.close()
            self._return_connection(conn)
    
    # Audit trail
    def _log_audit_trail(self, entity_type: str, entity_id: str, action: str, details: Dict[str, Any]):
        """Log audit trail entry"""
        conn = self._get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO mojaloop_audit_trail (entity_type, entity_id, action, details)
                VALUES (%s, %s, %s, %s)
            """, (entity_type, entity_id, action, json.dumps(details)))
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to log audit trail: {e}")
        finally:
            cursor.close()
            self._return_connection(conn)
    
    def close(self):
        """Close connection pool"""
        if self.connection_pool:
            self.connection_pool.closeall()
            logger.info("Mojaloop PostgreSQL connection pool closed")


# Example usage
if __name__ == '__main__':
    db = MojaloopPostgresIntegration()
    
    # Register PAPSS integration
    papss_system = {
        'system_name': 'PAPSS',
        'system_type': 'pan_african',
        'participant_id': None,
        'configuration': json.dumps({
            'api_url': 'https://api.papss.com',
            'corridors': ['EAC', 'ECOWAS', 'SADC', 'CEMAC'],
            'currencies': ['NGN', 'KES', 'GHS', 'ZAR']
        }),
        'status': 'ACTIVE'
    }
    
    # Register UPI integration
    upi_system = {
        'system_name': 'UPI',
        'system_type': 'india_instant',
        'participant_id': None,
        'configuration': json.dumps({
            'api_url': 'https://api.npci.org.in/upi',
            'supported_banks': ['SBI', 'HDFC', 'ICICI', 'Axis'],
            'currency': 'INR'
        }),
        'status': 'ACTIVE'
    }
    
    db.register_payment_system(papss_system)
    db.register_payment_system(upi_system)
    
    print("Payment systems registered successfully")
    
    # Get all integrations
    integrations = db.get_payment_system_integrations()
    print(f"Active integrations: {len(integrations)}")
    
    db.close()

