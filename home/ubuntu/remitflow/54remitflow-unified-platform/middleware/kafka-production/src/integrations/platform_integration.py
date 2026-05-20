"""
Platform Integration Module
Integrates Kafka with TigerBeetle and PostgreSQL
"""

import json
import logging
import asyncio
from typing import Dict, Any
from datetime import datetime
import uuid

# Import producers and consumers
import sys
sys.path.append('..')
from producers.transaction_producer import TransactionProducer
from consumers.transaction_consumer import TransactionConsumer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class PlatformIntegration:
    """
    Integrates Kafka event streaming with TigerBeetle and PostgreSQL
    
    Architecture:
    - TigerBeetle events → Kafka → PostgreSQL metadata
    - PostgreSQL events → Kafka → TigerBeetle sync
    - Fraud detection → Kafka → All systems
    """
    
    def __init__(self):
        """Initialize platform integration"""
        self.producer = TransactionProducer()
        logger.info("PlatformIntegration initialized")
    
    async def handle_tigerbeetle_transfer(self, transfer_data: Dict[str, Any]):
        """
        Handle TigerBeetle transfer and publish to Kafka
        
        Args:
            transfer_data: Transfer data from TigerBeetle
        """
        try:
            # Extract transfer details
            transaction_id = transfer_data.get('id', str(uuid.uuid4()))
            
            # Create transaction created event
            event = {
                'transaction_id': transaction_id,
                'sender_id': transfer_data.get('debit_account_id'),
                'receiver_id': transfer_data.get('credit_account_id'),
                'amount': float(transfer_data.get('amount', 0)),
                'currency': transfer_data.get('ledger', 'NGN'),  # Map ledger to currency
                'corridor': transfer_data.get('corridor', 'PAPSS'),
                'status': 'PENDING',
                'created_at': int(datetime.now().timestamp() * 1000),
                'metadata': {
                    'source': 'tigerbeetle',
                    'tigerbeetle_id': str(transfer_data.get('id'))
                }
            }
            
            # Publish to Kafka
            success = self.producer.publish_transaction_created(event)
            
            if success:
                logger.info(f"Published TigerBeetle transfer to Kafka: {transaction_id}")
            else:
                logger.error(f"Failed to publish TigerBeetle transfer: {transaction_id}")
            
            return success
        
        except Exception as e:
            logger.error(f"Error handling TigerBeetle transfer: {e}")
            return False
    
    async def handle_postgres_user_event(self, user_data: Dict[str, Any]):
        """
        Handle PostgreSQL user event and publish to Kafka
        
        Args:
            user_data: User data from PostgreSQL
        """
        try:
            # Create user created event
            event = {
                'user_id': user_data.get('id', str(uuid.uuid4())),
                'email': user_data.get('email'),
                'phone': user_data.get('phone'),
                'country_code': user_data.get('country_code', 'NG'),
                'kyc_level': user_data.get('kyc_level', 'LEVEL_0'),
                'created_at': int(datetime.now().timestamp() * 1000),
                'referral_code': user_data.get('referral_code')
            }
            
            # Publish to Kafka (would use user producer in full implementation)
            logger.info(f"Would publish user event to Kafka: {event['user_id']}")
            
            return True
        
        except Exception as e:
            logger.error(f"Error handling PostgreSQL user event: {e}")
            return False
    
    async def handle_fraud_detection(self, transaction_id: str, fraud_score: float):
        """
        Handle fraud detection result and publish alert if needed
        
        Args:
            transaction_id: Transaction ID
            fraud_score: Fraud probability score (0.0 to 1.0)
        """
        try:
            # Determine risk level
            if fraud_score >= 0.8:
                risk_level = 'CRITICAL'
                action = 'BLOCKED'
            elif fraud_score >= 0.6:
                risk_level = 'HIGH'
                action = 'REVIEW_REQUIRED'
            elif fraud_score >= 0.4:
                risk_level = 'MEDIUM'
                action = 'FLAGGED'
            else:
                risk_level = 'LOW'
                action = 'NONE'
            
            # Only publish alert for medium risk and above
            if fraud_score >= 0.4:
                alert = {
                    'alert_id': str(uuid.uuid4()),
                    'transaction_id': transaction_id,
                    'user_id': 'extracted_from_transaction',  # Would get from transaction
                    'fraud_score': fraud_score,
                    'risk_level': risk_level,
                    'detected_at': int(datetime.now().timestamp() * 1000),
                    'fraud_indicators': [
                        'high_fraud_score',
                        'ml_model_detection'
                    ],
                    'action_taken': action,
                    'model_version': 'v2.1.0'
                }
                
                success = self.producer.publish_fraud_alert(alert)
                
                if success:
                    logger.warning(
                        f"Published fraud alert: {alert['alert_id']}, "
                        f"score: {fraud_score}, action: {action}"
                    )
                
                return success
            
            return True
        
        except Exception as e:
            logger.error(f"Error handling fraud detection: {e}")
            return False
    
    def close(self):
        """Close all connections"""
        self.producer.close()
        logger.info("PlatformIntegration closed")


class KafkaToPostgresSync:
    """
    Syncs Kafka events to PostgreSQL
    Consumes transaction events and updates PostgreSQL metadata
    """
    
    def __init__(self):
        """Initialize sync service"""
        self.consumer = TransactionConsumer(group_id='postgres-sync-group')
        logger.info("KafkaToPostgresSync initialized")
    
    def start(self):
        """Start syncing events to PostgreSQL"""
        logger.info("Starting Kafka → PostgreSQL sync...")
        
        # Subscribe to relevant topics
        self.consumer.subscribe([
            'transactions.created',
            'transactions.completed',
            'transactions.failed',
            'fraud.alerts'
        ])
        
        # Start consuming
        self.consumer.consume(message_handler=self.handle_message)
    
    def handle_message(self, message: Dict[str, Any]) -> bool:
        """
        Handle Kafka message and sync to PostgreSQL
        
        Args:
            message: Kafka message
            
        Returns:
            bool: True if processed successfully
        """
        try:
            topic = message['topic']
            value = message['value']
            
            if topic == 'transactions.created':
                return self._sync_transaction_created(value)
            elif topic == 'transactions.completed':
                return self._sync_transaction_completed(value)
            elif topic == 'transactions.failed':
                return self._sync_transaction_failed(value)
            elif topic == 'fraud.alerts':
                return self._sync_fraud_alert(value)
            else:
                logger.warning(f"Unknown topic: {topic}")
                return True
        
        except Exception as e:
            logger.error(f"Error handling message: {e}")
            return False
    
    def _sync_transaction_created(self, transaction: Dict[str, Any]) -> bool:
        """Sync transaction created event to PostgreSQL"""
        try:
            # In production, this would:
            # 1. Connect to PostgreSQL
            # 2. Insert/update transaction metadata
            # 3. Update user statistics
            
            logger.info(
                f"Syncing transaction to PostgreSQL: {transaction['transaction_id']}"
            )
            
            # Implement PostgreSQL insert
            import asyncpg
            import asyncio
            
            async def insert_transaction():
                conn = await asyncpg.connect(
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=int(os.getenv('DB_PORT', 5432)),
                    database=os.getenv('DB_NAME', 'remittance'),
                    user=os.getenv('DB_USER', 'postgres'),
                    password=os.getenv('DB_PASSWORD', '')
                )
                
                await conn.execute(
                    '''INSERT INTO transfer_metadata 
                       (transaction_id, sender_id, recipient_id, amount, currency, 
                        status, payment_system, created_at, metadata)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
                       ON CONFLICT (transaction_id) DO UPDATE
                       SET status = EXCLUDED.status, updated_at = NOW()''',
                    transaction['transaction_id'],
                    transaction.get('sender_id'),
                    transaction.get('recipient_id'),
                    float(transaction['amount']),
                    transaction['currency'],
                    'CREATED',
                    transaction.get('payment_system', 'MOJALOOP'),
                    json.dumps(transaction.get('metadata', {}))
                )
                
                await conn.close()
            
            asyncio.run(insert_transaction())
            
            return True
        
        except Exception as e:
            logger.error(f"Error syncing transaction created: {e}")
            return False
    
    def _sync_transaction_completed(self, transaction: Dict[str, Any]) -> bool:
        """Sync transaction completed event to PostgreSQL"""
        try:
            logger.info(
                f"Updating completed transaction in PostgreSQL: "
                f"{transaction['transaction_id']}"
            )
            
            # Implement PostgreSQL update
            import asyncpg
            import asyncio
            
            async def update_transaction():
                conn = await asyncpg.connect(
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=int(os.getenv('DB_PORT', 5432)),
                    database=os.getenv('DB_NAME', 'remittance'),
                    user=os.getenv('DB_USER', 'postgres'),
                    password=os.getenv('DB_PASSWORD', '')
                )
                
                await conn.execute(
                    '''UPDATE transfer_metadata 
                       SET status = 'COMPLETED', 
                           completed_at = NOW(),
                           updated_at = NOW()
                       WHERE transaction_id = $1''',
                    transaction['transaction_id']
                )
                
                await conn.close()
            
            asyncio.run(update_transaction())
            
            return True
        
        except Exception as e:
            logger.error(f"Error syncing transaction completed: {e}")
            return False
    
    def _sync_transaction_failed(self, transaction: Dict[str, Any]) -> bool:
        """Sync transaction failed event to PostgreSQL"""
        try:
            logger.info(
                f"Updating failed transaction in PostgreSQL: "
                f"{transaction['transaction_id']}"
            )
            
            # Implement PostgreSQL update
            import asyncpg
            import asyncio
            
            async def update_failed_transaction():
                conn = await asyncpg.connect(
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=int(os.getenv('DB_PORT', 5432)),
                    database=os.getenv('DB_NAME', 'remittance'),
                    user=os.getenv('DB_USER', 'postgres'),
                    password=os.getenv('DB_PASSWORD', '')
                )
                
                await conn.execute(
                    '''UPDATE transfer_metadata 
                       SET status = 'FAILED', 
                           failure_reason = $2,
                           failed_at = NOW(),
                           updated_at = NOW()
                       WHERE transaction_id = $1''',
                    transaction['transaction_id'],
                    transaction.get('failure_reason', 'Unknown error')
                )
                
                await conn.close()
            
            asyncio.run(update_failed_transaction())
            
            return True
        
        except Exception as e:
            logger.error(f"Error syncing transaction failed: {e}")
            return False
    
    def _sync_fraud_alert(self, alert: Dict[str, Any]) -> bool:
        """Sync fraud alert to PostgreSQL"""
        try:
            logger.warning(
                f"Storing fraud alert in PostgreSQL: {alert['alert_id']}"
            )
            
            # Implement PostgreSQL insert
            import asyncpg
            import asyncio
            
            async def insert_fraud_alert():
                conn = await asyncpg.connect(
                    host=os.getenv('DB_HOST', 'localhost'),
                    port=int(os.getenv('DB_PORT', 5432)),
                    database=os.getenv('DB_NAME', 'remittance'),
                    user=os.getenv('DB_USER', 'postgres'),
                    password=os.getenv('DB_PASSWORD', '')
                )
                
                await conn.execute(
                    '''INSERT INTO fraud_alerts 
                       (alert_id, transaction_id, user_id, fraud_score, risk_level, 
                        alert_type, details, created_at)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                       ON CONFLICT (alert_id) DO UPDATE
                       SET fraud_score = EXCLUDED.fraud_score,
                           risk_level = EXCLUDED.risk_level,
                           updated_at = NOW()''',
                    alert['alert_id'],
                    alert.get('transaction_id'),
                    alert.get('user_id'),
                    float(alert['fraud_score']),
                    alert['risk_level'],
                    alert.get('alert_type', 'TRANSACTION_FRAUD'),
                    json.dumps(alert.get('details', {}))
                )
                
                await conn.close()
            
            asyncio.run(insert_fraud_alert())
            
            return True
        
        except Exception as e:
            logger.error(f"Error syncing fraud alert: {e}")
            return False


# Example usage
if __name__ == '__main__':
    # Example 1: Integrate TigerBeetle transfer
    integration = PlatformIntegration()
    
    tigerbeetle_transfer = {
        'id': 12345,
        'debit_account_id': 'account_123',
        'credit_account_id': 'account_456',
        'amount': 50000,
        'ledger': 710,  # NGN
        'corridor': 'PAPSS'
    }
    
    asyncio.run(integration.handle_tigerbeetle_transfer(tigerbeetle_transfer))
    
    # Example 2: Handle fraud detection
    asyncio.run(integration.handle_fraud_detection('txn_123', 0.85))
    
    integration.close()
    
    # Example 3: Start PostgreSQL sync (runs continuously)
    # sync = KafkaToPostgresSync()
    # sync.start()

