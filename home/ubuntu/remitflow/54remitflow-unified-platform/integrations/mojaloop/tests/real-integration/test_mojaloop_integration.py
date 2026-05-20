"""
Real Integration Tests for Mojaloop Hub
Tests with actual PostgreSQL, TigerBeetle, and payment system integrations
"""

import pytest
import asyncio
import psycopg2
from decimal import Decimal
from datetime import datetime, timedelta
import uuid
import os
import time


# Import production modules
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../'))

from database.mojaloop_postgres import MojaloopPostgresIntegration
from monitoring.prometheus.mojaloop_metrics import get_metrics_exporter


@pytest.fixture(scope="session")
def database_url():
    """Get database URL from environment"""
    return os.getenv('DATABASE_URL', 'postgresql://mojaloop:password@localhost:5432/mojaloop_test')


@pytest.fixture(scope="session")
def db_integration(database_url):
    """Create database integration instance"""
    db = MojaloopPostgresIntegration(database_url)
    yield db
    db.close()


@pytest.fixture
def metrics_exporter():
    """Get metrics exporter"""
    return get_metrics_exporter()


class TestParticipantOperations:
    """Test participant registration and management"""
    
    def test_create_participant(self, db_integration):
        """Test creating a new participant"""
        participant_data = {
            'participant_id': f'test-fsp-{uuid.uuid4().hex[:8]}',
            'name': 'Test Financial Service Provider',
            'type': 'DFSP',
            'currency': 'NGN',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 1001,
            'endpoints': '{"callback_url": "https://test-fsp.com/callback"}',
            'capabilities': '{"supports_cross_border": true}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        participant_id = db_integration.create_participant(participant_data)
        assert participant_id is not None
        assert participant_id > 0
        
        # Verify participant was created
        participant = db_integration.get_participant(participant_data['participant_id'])
        assert participant is not None
        assert participant['name'] == participant_data['name']
        assert participant['currency'] == 'NGN'
        assert participant['status'] == 'ACTIVE'
    
    def test_get_participant(self, db_integration):
        """Test retrieving a participant"""
        # Create participant first
        participant_data = {
            'participant_id': f'test-fsp-{uuid.uuid4().hex[:8]}',
            'name': 'Another Test FSP',
            'type': 'DFSP',
            'currency': 'INR',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 1002,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        db_integration.create_participant(participant_data)
        
        # Retrieve participant
        participant = db_integration.get_participant(participant_data['participant_id'])
        assert participant is not None
        assert participant['currency'] == 'INR'


class TestQuoteOperations:
    """Test quote creation and management"""
    
    @pytest.fixture
    def test_participants(self, db_integration):
        """Create test participants"""
        payer_data = {
            'participant_id': f'payer-fsp-{uuid.uuid4().hex[:8]}',
            'name': 'Payer FSP',
            'type': 'DFSP',
            'currency': 'INR',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 2001,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        payee_data = {
            'participant_id': f'payee-fsp-{uuid.uuid4().hex[:8]}',
            'name': 'Payee FSP',
            'type': 'DFSP',
            'currency': 'NGN',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 2002,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        db_integration.create_participant(payer_data)
        db_integration.create_participant(payee_data)
        
        return payer_data['participant_id'], payee_data['participant_id']
    
    def test_create_quote(self, db_integration, test_participants):
        """Test creating a quote"""
        payer_fsp, payee_fsp = test_participants
        
        quote_data = {
            'quote_id': str(uuid.uuid4()),
            'transaction_id': str(uuid.uuid4()),
            'payer_fsp': payer_fsp,
            'payee_fsp': payee_fsp,
            'amount_type': 'SEND',
            'amount': Decimal('10000.00'),
            'currency': 'INR',
            'fees': Decimal('0.00'),
            'commission': Decimal('0.00'),
            'transfer_amount': Decimal('51200.00'),
            'exchange_rate': Decimal('5.12'),
            'expiration': datetime.now() + timedelta(minutes=5),
            'geo_code': None,
            'note': 'Cross-border payment India to Nigeria',
            'status': 'PENDING'
        }
        
        quote_id = db_integration.create_quote(quote_data)
        assert quote_id is not None
        assert quote_id > 0
        
        # Verify quote was created
        quote = db_integration.get_quote(quote_data['quote_id'])
        assert quote is not None
        assert float(quote['amount']) == 10000.00
        assert quote['currency'] == 'INR'
        assert quote['status'] == 'PENDING'
    
    def test_update_quote_status(self, db_integration, test_participants):
        """Test updating quote status"""
        payer_fsp, payee_fsp = test_participants
        
        quote_data = {
            'quote_id': str(uuid.uuid4()),
            'transaction_id': str(uuid.uuid4()),
            'payer_fsp': payer_fsp,
            'payee_fsp': payee_fsp,
            'amount_type': 'SEND',
            'amount': Decimal('5000.00'),
            'currency': 'INR',
            'fees': Decimal('0.00'),
            'commission': Decimal('0.00'),
            'transfer_amount': Decimal('25600.00'),
            'exchange_rate': Decimal('5.12'),
            'expiration': datetime.now() + timedelta(minutes=5),
            'geo_code': None,
            'note': 'Test quote',
            'status': 'PENDING'
        }
        
        db_integration.create_quote(quote_data)
        
        # Update status
        db_integration.update_quote_status(quote_data['quote_id'], 'APPROVED')
        
        # Verify status updated
        quote = db_integration.get_quote(quote_data['quote_id'])
        assert quote['status'] == 'APPROVED'


class TestTransferOperations:
    """Test transfer operations"""
    
    @pytest.fixture
    def test_quote(self, db_integration):
        """Create test quote"""
        # Create participants
        payer_data = {
            'participant_id': f'payer-{uuid.uuid4().hex[:8]}',
            'name': 'Payer',
            'type': 'DFSP',
            'currency': 'INR',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 3001,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        payee_data = {
            'participant_id': f'payee-{uuid.uuid4().hex[:8]}',
            'name': 'Payee',
            'type': 'DFSP',
            'currency': 'NGN',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 3002,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        db_integration.create_participant(payer_data)
        db_integration.create_participant(payee_data)
        
        # Create quote
        quote_data = {
            'quote_id': str(uuid.uuid4()),
            'transaction_id': str(uuid.uuid4()),
            'payer_fsp': payer_data['participant_id'],
            'payee_fsp': payee_data['participant_id'],
            'amount_type': 'SEND',
            'amount': Decimal('20000.00'),
            'currency': 'INR',
            'fees': Decimal('0.00'),
            'commission': Decimal('0.00'),
            'transfer_amount': Decimal('102400.00'),
            'exchange_rate': Decimal('5.12'),
            'expiration': datetime.now() + timedelta(minutes=5),
            'geo_code': None,
            'note': 'Test transfer',
            'status': 'APPROVED'
        }
        
        db_integration.create_quote(quote_data)
        
        return quote_data
    
    def test_create_transfer(self, db_integration, test_quote):
        """Test creating a transfer"""
        transfer_data = {
            'transfer_id': str(uuid.uuid4()),
            'quote_id': test_quote['quote_id'],
            'payer_fsp': test_quote['payer_fsp'],
            'payee_fsp': test_quote['payee_fsp'],
            'amount': test_quote['transfer_amount'],
            'currency': 'NGN',
            'condition': 'test_condition_hash',
            'expiration': datetime.now() + timedelta(minutes=5),
            'transfer_state': 'RESERVED',
            'tigerbeetle_transfer_id': 5001,
            'settlement_window_id': 'SW-001',
            'extensions': '{}'
        }
        
        transfer_id = db_integration.create_transfer(transfer_data)
        assert transfer_id is not None
        assert transfer_id > 0
        
        # Verify transfer was created
        transfer = db_integration.get_transfer(transfer_data['transfer_id'])
        assert transfer is not None
        assert transfer['transfer_state'] == 'RESERVED'
        assert float(transfer['amount']) == float(test_quote['transfer_amount'])
    
    def test_update_transfer_state(self, db_integration, test_quote):
        """Test updating transfer state"""
        transfer_data = {
            'transfer_id': str(uuid.uuid4()),
            'quote_id': test_quote['quote_id'],
            'payer_fsp': test_quote['payer_fsp'],
            'payee_fsp': test_quote['payee_fsp'],
            'amount': test_quote['transfer_amount'],
            'currency': 'NGN',
            'condition': 'test_condition',
            'expiration': datetime.now() + timedelta(minutes=5),
            'transfer_state': 'RESERVED',
            'tigerbeetle_transfer_id': 5002,
            'settlement_window_id': 'SW-001',
            'extensions': '{}'
        }
        
        db_integration.create_transfer(transfer_data)
        
        # Update to COMMITTED
        db_integration.update_transfer_state(
            transfer_data['transfer_id'],
            'COMMITTED',
            fulfillment='test_fulfillment_hash'
        )
        
        # Verify state updated
        transfer = db_integration.get_transfer(transfer_data['transfer_id'])
        assert transfer['transfer_state'] == 'COMMITTED'
        assert transfer['fulfillment'] == 'test_fulfillment_hash'
        assert transfer['completed_at'] is not None


class TestPaymentSystemIntegrations:
    """Test payment system integrations"""
    
    def test_register_upi_integration(self, db_integration):
        """Test registering UPI payment system"""
        upi_system = {
            'system_name': 'UPI',
            'system_type': 'india_instant',
            'participant_id': None,
            'configuration': '{"api_url": "https://api.npci.org.in/upi", "currency": "INR"}',
            'status': 'ACTIVE'
        }
        
        system_id = db_integration.register_payment_system(upi_system)
        assert system_id is not None
        assert system_id > 0
    
    def test_register_papss_integration(self, db_integration):
        """Test registering PAPSS payment system"""
        papss_system = {
            'system_name': 'PAPSS',
            'system_type': 'pan_african',
            'participant_id': None,
            'configuration': '{"api_url": "https://api.papss.com", "corridors": ["EAC", "ECOWAS"]}',
            'status': 'ACTIVE'
        }
        
        system_id = db_integration.register_payment_system(papss_system)
        assert system_id is not None
    
    def test_get_all_integrations(self, db_integration):
        """Test retrieving all payment system integrations"""
        integrations = db_integration.get_payment_system_integrations()
        assert integrations is not None
        assert len(integrations) >= 0


class TestEndToEndPaymentFlow:
    """Test complete end-to-end payment flow"""
    
    @pytest.mark.asyncio
    async def test_complete_payment_flow(self, db_integration, metrics_exporter):
        """Test complete payment flow from quote to settlement"""
        start_time = time.time()
        
        # Step 1: Create participants
        payer_id = f'upi-india-{uuid.uuid4().hex[:8]}'
        payee_id = f'papss-nigeria-{uuid.uuid4().hex[:8]}'
        
        payer_data = {
            'participant_id': payer_id,
            'name': 'UPI India',
            'type': 'DFSP',
            'currency': 'INR',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 9001,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        payee_data = {
            'participant_id': payee_id,
            'name': 'PAPSS Nigeria',
            'type': 'DFSP',
            'currency': 'NGN',
            'status': 'ACTIVE',
            'tigerbeetle_account_id': 9002,
            'endpoints': '{}',
            'capabilities': '{}',
            'settlement_model': 'DEFERRED_NET',
            'metadata': '{}'
        }
        
        db_integration.create_participant(payer_data)
        db_integration.create_participant(payee_data)
        
        # Step 2: Create quote
        quote_id = str(uuid.uuid4())
        transaction_id = str(uuid.uuid4())
        
        quote_data = {
            'quote_id': quote_id,
            'transaction_id': transaction_id,
            'payer_fsp': payer_id,
            'payee_fsp': payee_id,
            'amount_type': 'SEND',
            'amount': Decimal('50000.00'),
            'currency': 'INR',
            'fees': Decimal('0.00'),
            'commission': Decimal('0.00'),
            'transfer_amount': Decimal('256000.00'),
            'exchange_rate': Decimal('5.12'),
            'expiration': datetime.now() + timedelta(minutes=5),
            'geo_code': None,
            'note': 'India to Nigeria cross-border payment',
            'status': 'PENDING'
        }
        
        db_integration.create_quote(quote_data)
        quote_time = time.time() - start_time
        
        # Record metrics
        metrics_exporter.record_quote_created(
            payer_id, payee_id, 'INR', 50000.00, 0.00, quote_time
        )
        
        # Step 3: Approve quote
        db_integration.update_quote_status(quote_id, 'APPROVED')
        
        # Step 4: Prepare transfer
        transfer_id = str(uuid.uuid4())
        
        transfer_data = {
            'transfer_id': transfer_id,
            'quote_id': quote_id,
            'payer_fsp': payer_id,
            'payee_fsp': payee_id,
            'amount': Decimal('256000.00'),
            'currency': 'NGN',
            'condition': hashlib.sha256(transfer_id.encode()).hexdigest(),
            'expiration': datetime.now() + timedelta(minutes=5),
            'transfer_state': 'RESERVED',
            'tigerbeetle_transfer_id': 9999,
            'settlement_window_id': 'SW-TEST-001',
            'extensions': '{}'
        }
        
        db_integration.create_transfer(transfer_data)
        prepare_time = time.time() - start_time - quote_time
        
        # Record metrics
        metrics_exporter.record_transfer_prepared(
            payer_id, payee_id, 'NGN', 256000.00, prepare_time
        )
        
        # Step 5: Fulfill transfer
        import hashlib
        fulfillment = hashlib.sha512(transfer_id.encode()).hexdigest()
        
        db_integration.update_transfer_state(
            transfer_id,
            'COMMITTED',
            fulfillment=fulfillment
        )
        
        fulfill_time = time.time() - start_time - quote_time - prepare_time
        
        # Record metrics
        metrics_exporter.record_transfer_fulfilled(payer_id, payee_id, fulfill_time)
        
        total_time = time.time() - start_time
        
        # Record cross-border payment metrics
        metrics_exporter.record_cross_border_payment(
            'INR', 'NGN', 'India-Nigeria', 50000.00, 5.12, total_time, 'SUCCESS'
        )
        
        # Verify final state
        transfer = db_integration.get_transfer(transfer_id)
        assert transfer['transfer_state'] == 'COMMITTED'
        assert transfer['fulfillment'] == fulfillment
        
        # Verify timing
        assert total_time < 5.0  # Should complete in less than 5 seconds
        
        print(f"\nEnd-to-end payment flow completed in {total_time:.3f} seconds")
        print(f"  - Quote creation: {quote_time:.3f}s")
        print(f"  - Transfer preparation: {prepare_time:.3f}s")
        print(f"  - Transfer fulfillment: {fulfill_time:.3f}s")


class TestMetricsExport:
    """Test metrics export"""
    
    def test_metrics_export(self, metrics_exporter):
        """Test that metrics can be exported"""
        # Record some metrics
        metrics_exporter.record_upi_transaction('P2P', 'SUCCESS')
        metrics_exporter.update_system_health('UPI', True)
        metrics_exporter.update_system_health('PAPSS', True)
        
        # Export metrics
        metrics_data = metrics_exporter.get_metrics()
        
        assert metrics_data is not None
        assert len(metrics_data) > 0
        assert b'mojaloop' in metrics_data


# Performance tests
class TestPerformance:
    """Performance and load tests"""
    
    @pytest.mark.performance
    def test_quote_creation_performance(self, db_integration):
        """Test quote creation performance"""
        # Create participants
        payer_id = f'perf-payer-{uuid.uuid4().hex[:8]}'
        payee_id = f'perf-payee-{uuid.uuid4().hex[:8]}'
        
        for participant_id in [payer_id, payee_id]:
            db_integration.create_participant({
                'participant_id': participant_id,
                'name': f'Perf Test {participant_id}',
                'type': 'DFSP',
                'currency': 'NGN',
                'status': 'ACTIVE',
                'tigerbeetle_account_id': hash(participant_id) % 1000000,
                'endpoints': '{}',
                'capabilities': '{}',
                'settlement_model': 'DEFERRED_NET',
                'metadata': '{}'
            })
        
        # Create 100 quotes and measure time
        start_time = time.time()
        
        for i in range(100):
            quote_data = {
                'quote_id': str(uuid.uuid4()),
                'transaction_id': str(uuid.uuid4()),
                'payer_fsp': payer_id,
                'payee_fsp': payee_id,
                'amount_type': 'SEND',
                'amount': Decimal('1000.00'),
                'currency': 'NGN',
                'fees': Decimal('10.00'),
                'commission': Decimal('0.00'),
                'transfer_amount': Decimal('1010.00'),
                'exchange_rate': Decimal('1.0'),
                'expiration': datetime.now() + timedelta(minutes=5),
                'geo_code': None,
                'note': f'Performance test {i}',
                'status': 'PENDING'
            }
            
            db_integration.create_quote(quote_data)
        
        elapsed_time = time.time() - start_time
        quotes_per_second = 100 / elapsed_time
        
        print(f"\nCreated 100 quotes in {elapsed_time:.3f} seconds")
        print(f"Throughput: {quotes_per_second:.2f} quotes/second")
        
        # Should be able to create at least 50 quotes per second
        assert quotes_per_second >= 50


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])

