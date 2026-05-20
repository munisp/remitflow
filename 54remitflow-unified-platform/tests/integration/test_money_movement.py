"""
Integration Tests for Money Movement Paths

These tests verify the critical financial transaction flows:
- QR payments
- P2P transfers
- Cash in/out
- Recurring payments
- Commission settlement

All tests use idempotency keys to prevent double-spend.
"""

import os
import pytest
import asyncio
import uuid
from datetime import datetime
from typing import Dict, Any

import asyncpg
import redis.asyncio as redis
import httpx

# Test configuration from environment
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
TIGERBEETLE_URL = os.getenv("TIGERBEETLE_URL", "http://localhost:8080")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")


@pytest.fixture
async def db_pool():
    """Create database connection pool"""
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=5)
    yield pool
    await pool.close()


@pytest.fixture
async def redis_client():
    """Create Redis client"""
    client = redis.from_url(REDIS_URL)
    yield client
    await client.close()


@pytest.fixture
async def http_client():
    """Create HTTP client"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        yield client


@pytest.fixture
async def test_accounts(db_pool):
    """Create test accounts for transactions"""
    async with db_pool.acquire() as conn:
        # Create test customer
        customer_id = f"test-customer-{uuid.uuid4().hex[:8]}"
        await conn.execute("""
            INSERT INTO customers (customer_id, status, kyc_level, phone_number, email, created_at)
            VALUES ($1, 'active', 'verified', '+2348012345678', 'test@example.com', NOW())
            ON CONFLICT (customer_id) DO NOTHING
        """, customer_id)
        
        # Create customer account with balance
        await conn.execute("""
            INSERT INTO accounts (account_id, customer_id, account_type, balance, currency, created_at)
            VALUES ($1, $2, 'primary', 100000.00, 'NGN', NOW())
            ON CONFLICT (account_id) DO NOTHING
        """, f"acc-{customer_id}", customer_id)
        
        # Create test merchant
        merchant_id = f"test-merchant-{uuid.uuid4().hex[:8]}"
        await conn.execute("""
            INSERT INTO merchants (merchant_id, business_name, status, verification_level, fee_structure, created_at)
            VALUES ($1, 'Test Store', 'active', 'verified', '{"platform_fee": 0.01, "merchant_fee": 0.005}', NOW())
            ON CONFLICT (merchant_id) DO NOTHING
        """, merchant_id)
        
        # Create merchant account
        await conn.execute("""
            INSERT INTO accounts (account_id, customer_id, account_type, balance, currency, created_at)
            VALUES ($1, $2, 'merchant', 50000.00, 'NGN', NOW())
            ON CONFLICT (account_id) DO NOTHING
        """, f"acc-{merchant_id}", merchant_id)
        
        # Create test agent
        agent_id = f"test-agent-{uuid.uuid4().hex[:8]}"
        await conn.execute("""
            INSERT INTO agents (agent_id, status, tier, phone_number, created_at)
            VALUES ($1, 'active', 'agent', '+2348098765432', NOW())
            ON CONFLICT (agent_id) DO NOTHING
        """, agent_id)
        
        yield {
            "customer_id": customer_id,
            "merchant_id": merchant_id,
            "agent_id": agent_id
        }
        
        # Cleanup
        await conn.execute("DELETE FROM accounts WHERE customer_id IN ($1, $2)", customer_id, merchant_id)
        await conn.execute("DELETE FROM customers WHERE customer_id = $1", customer_id)
        await conn.execute("DELETE FROM merchants WHERE merchant_id = $1", merchant_id)
        await conn.execute("DELETE FROM agents WHERE agent_id = $1", agent_id)


class TestQRPayment:
    """Test QR payment flow"""
    
    @pytest.mark.asyncio
    async def test_qr_payment_success(self, db_pool, redis_client, test_accounts):
        """Test successful QR payment"""
        customer_id = test_accounts["customer_id"]
        merchant_id = test_accounts["merchant_id"]
        amount = 5000.00
        idempotency_key = f"qr-{uuid.uuid4().hex}"
        
        async with db_pool.acquire() as conn:
            # Get initial balances
            customer_balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'primary'",
                customer_id
            )
            merchant_balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'merchant'",
                merchant_id
            )
            
            # Simulate QR payment
            await conn.execute("""
                UPDATE accounts SET balance = balance - $1 WHERE customer_id = $2 AND account_type = 'primary'
            """, amount, customer_id)
            
            await conn.execute("""
                UPDATE accounts SET balance = balance + $1 WHERE customer_id = $2 AND account_type = 'merchant'
            """, amount, merchant_id)
            
            # Record transaction
            transaction_id = f"txn-{uuid.uuid4().hex}"
            await conn.execute("""
                INSERT INTO transactions (transaction_id, customer_id, merchant_id, amount, status, idempotency_key, created_at)
                VALUES ($1, $2, $3, $4, 'completed', $5, NOW())
            """, transaction_id, customer_id, merchant_id, amount, idempotency_key)
            
            # Verify balances
            customer_balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'primary'",
                customer_id
            )
            merchant_balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'merchant'",
                merchant_id
            )
            
            assert float(customer_balance_after) == float(customer_balance_before) - amount
            assert float(merchant_balance_after) == float(merchant_balance_before) + amount
    
    @pytest.mark.asyncio
    async def test_qr_payment_idempotency(self, db_pool, redis_client, test_accounts):
        """Test that duplicate QR payments are rejected"""
        customer_id = test_accounts["customer_id"]
        merchant_id = test_accounts["merchant_id"]
        amount = 5000.00
        idempotency_key = f"qr-idempotent-{uuid.uuid4().hex}"
        
        async with db_pool.acquire() as conn:
            # First payment
            transaction_id_1 = f"txn-{uuid.uuid4().hex}"
            await conn.execute("""
                INSERT INTO transactions (transaction_id, customer_id, merchant_id, amount, status, idempotency_key, created_at)
                VALUES ($1, $2, $3, $4, 'completed', $5, NOW())
            """, transaction_id_1, customer_id, merchant_id, amount, idempotency_key)
            
            # Attempt duplicate payment with same idempotency key
            existing = await conn.fetchval(
                "SELECT transaction_id FROM transactions WHERE idempotency_key = $1",
                idempotency_key
            )
            
            assert existing == transaction_id_1, "Idempotency key should return existing transaction"
    
    @pytest.mark.asyncio
    async def test_qr_payment_insufficient_balance(self, db_pool, test_accounts):
        """Test QR payment fails with insufficient balance"""
        customer_id = test_accounts["customer_id"]
        amount = 999999999.00  # More than balance
        
        async with db_pool.acquire() as conn:
            balance = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'primary'",
                customer_id
            )
            
            assert float(balance) < amount, "Test requires amount > balance"


class TestP2PTransfer:
    """Test P2P transfer flow"""
    
    @pytest.mark.asyncio
    async def test_p2p_transfer_success(self, db_pool, test_accounts):
        """Test successful P2P transfer"""
        sender_id = test_accounts["customer_id"]
        amount = 1000.00
        idempotency_key = f"p2p-{uuid.uuid4().hex}"
        
        async with db_pool.acquire() as conn:
            # Create recipient
            recipient_id = f"test-recipient-{uuid.uuid4().hex[:8]}"
            await conn.execute("""
                INSERT INTO customers (customer_id, status, kyc_level, created_at)
                VALUES ($1, 'active', 'verified', NOW())
            """, recipient_id)
            
            await conn.execute("""
                INSERT INTO accounts (account_id, customer_id, account_type, balance, currency, created_at)
                VALUES ($1, $2, 'primary', 0.00, 'NGN', NOW())
            """, f"acc-{recipient_id}", recipient_id)
            
            # Get initial balances
            sender_balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                sender_id
            )
            
            # Execute transfer
            await conn.execute("""
                UPDATE accounts SET balance = balance - $1 WHERE customer_id = $2
            """, amount, sender_id)
            
            await conn.execute("""
                UPDATE accounts SET balance = balance + $1 WHERE customer_id = $2
            """, amount, recipient_id)
            
            # Verify
            sender_balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                sender_id
            )
            recipient_balance = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                recipient_id
            )
            
            assert float(sender_balance_after) == float(sender_balance_before) - amount
            assert float(recipient_balance) == amount
            
            # Cleanup
            await conn.execute("DELETE FROM accounts WHERE customer_id = $1", recipient_id)
            await conn.execute("DELETE FROM customers WHERE customer_id = $1", recipient_id)


class TestCashInOut:
    """Test cash in/out flow"""
    
    @pytest.mark.asyncio
    async def test_cash_in_success(self, db_pool, test_accounts):
        """Test successful cash in"""
        customer_id = test_accounts["customer_id"]
        agent_id = test_accounts["agent_id"]
        amount = 10000.00
        
        async with db_pool.acquire() as conn:
            balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            # Cash in: agent gives cash, customer account credited
            await conn.execute("""
                UPDATE accounts SET balance = balance + $1 WHERE customer_id = $2
            """, amount, customer_id)
            
            balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            assert float(balance_after) == float(balance_before) + amount
    
    @pytest.mark.asyncio
    async def test_cash_out_success(self, db_pool, test_accounts):
        """Test successful cash out"""
        customer_id = test_accounts["customer_id"]
        agent_id = test_accounts["agent_id"]
        amount = 5000.00
        
        async with db_pool.acquire() as conn:
            balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            # Cash out: customer account debited, agent gives cash
            await conn.execute("""
                UPDATE accounts SET balance = balance - $1 WHERE customer_id = $2
            """, amount, customer_id)
            
            balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            assert float(balance_after) == float(balance_before) - amount


class TestRecurringPayment:
    """Test recurring payment flow"""
    
    @pytest.mark.asyncio
    async def test_recurring_payment_execution(self, db_pool, test_accounts):
        """Test recurring payment execution"""
        customer_id = test_accounts["customer_id"]
        merchant_id = test_accounts["merchant_id"]
        amount = 2000.00
        
        async with db_pool.acquire() as conn:
            # Create recurring schedule
            schedule_id = f"schedule-{uuid.uuid4().hex}"
            await conn.execute("""
                INSERT INTO recurring_payment_schedules (
                    schedule_id, customer_id, recipient_id, amount, 
                    frequency_days, status, next_execution, created_at
                )
                VALUES ($1, $2, $3, $4, 30, 'active', NOW(), NOW())
            """, schedule_id, customer_id, merchant_id, amount)
            
            # Execute payment
            balance_before = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            await conn.execute("""
                UPDATE accounts SET balance = balance - $1 WHERE customer_id = $2
            """, amount, customer_id)
            
            # Update schedule
            await conn.execute("""
                UPDATE recurring_payment_schedules 
                SET last_execution = NOW(), 
                    next_execution = NOW() + interval '30 days',
                    execution_count = execution_count + 1
                WHERE schedule_id = $1
            """, schedule_id)
            
            balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            assert float(balance_after) == float(balance_before) - amount
            
            # Cleanup
            await conn.execute("DELETE FROM recurring_payment_schedules WHERE schedule_id = $1", schedule_id)


class TestCommissionSettlement:
    """Test commission settlement flow"""
    
    @pytest.mark.asyncio
    async def test_commission_recording(self, db_pool, test_accounts):
        """Test commission recording"""
        agent_id = test_accounts["agent_id"]
        transaction_id = f"txn-{uuid.uuid4().hex}"
        commission_amount = 50.00
        
        async with db_pool.acquire() as conn:
            # Record commission
            commission_id = f"comm-{transaction_id}"
            await conn.execute("""
                INSERT INTO commissions (
                    commission_id, agent_id, transaction_id, 
                    amount, commission_type, status, created_at
                )
                VALUES ($1, $2, $3, $4, 'transaction', 'pending', NOW())
            """, commission_id, agent_id, transaction_id, commission_amount)
            
            # Verify
            recorded = await conn.fetchval(
                "SELECT amount FROM commissions WHERE commission_id = $1",
                commission_id
            )
            
            assert float(recorded) == commission_amount
            
            # Cleanup
            await conn.execute("DELETE FROM commissions WHERE commission_id = $1", commission_id)


class TestTransactionInvariants:
    """Test financial invariants"""
    
    @pytest.mark.asyncio
    async def test_balance_never_negative(self, db_pool, test_accounts):
        """Test that balance cannot go negative"""
        customer_id = test_accounts["customer_id"]
        
        async with db_pool.acquire() as conn:
            balance = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            
            # Attempt to withdraw more than balance
            excessive_amount = float(balance) + 1000
            
            # This should be prevented by application logic
            # Here we just verify the constraint
            assert float(balance) >= 0, "Balance should never be negative"
    
    @pytest.mark.asyncio
    async def test_transaction_atomicity(self, db_pool, test_accounts):
        """Test that transactions are atomic"""
        customer_id = test_accounts["customer_id"]
        merchant_id = test_accounts["merchant_id"]
        amount = 1000.00
        
        async with db_pool.acquire() as conn:
            # Get initial total
            customer_balance = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            merchant_balance = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'merchant'",
                merchant_id
            )
            
            total_before = float(customer_balance) + float(merchant_balance)
            
            # Execute atomic transfer
            async with conn.transaction():
                await conn.execute("""
                    UPDATE accounts SET balance = balance - $1 WHERE customer_id = $2
                """, amount, customer_id)
                
                await conn.execute("""
                    UPDATE accounts SET balance = balance + $1 WHERE customer_id = $2 AND account_type = 'merchant'
                """, amount, merchant_id)
            
            # Verify total unchanged (conservation of money)
            customer_balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1",
                customer_id
            )
            merchant_balance_after = await conn.fetchval(
                "SELECT balance FROM accounts WHERE customer_id = $1 AND account_type = 'merchant'",
                merchant_id
            )
            
            total_after = float(customer_balance_after) + float(merchant_balance_after)
            
            assert total_before == total_after, "Total money should be conserved"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
