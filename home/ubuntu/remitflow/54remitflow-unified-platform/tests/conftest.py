"""
Global pytest configuration and fixtures
"""

import pytest
import asyncio
from typing import Generator, AsyncGenerator
from faker import Faker
import redis
from unittest.mock import Mock, AsyncMock

# Initialize Faker
fake = Faker()


@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for async tests"""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def faker():
    """Provide Faker instance"""
    return fake


@pytest.fixture
def mock_redis():
    """Mock Redis client"""
    import fakeredis
    return fakeredis.FakeRedis()


@pytest.fixture
def mock_kafka_producer():
    """Mock Kafka producer"""
    producer = Mock()
    producer.send = AsyncMock(return_value=Mock(get=Mock(return_value=None)))
    producer.flush = Mock()
    return producer


@pytest.fixture
def mock_database():
    """Mock database session"""
    from unittest.mock import MagicMock
    db = MagicMock()
    db.query = MagicMock()
    db.add = MagicMock()
    db.commit = MagicMock()
    db.rollback = MagicMock()
    db.close = MagicMock()
    return db


@pytest.fixture
def sample_agent():
    """Sample agent data"""
    return {
        "agent_id": fake.uuid4(),
        "name": fake.name(),
        "email": fake.email(),
        "phone": fake.phone_number(),
        "location": fake.city(),
        "status": "active"
    }


@pytest.fixture
def sample_product():
    """Sample product data"""
    return {
        "product_id": fake.uuid4(),
        "name": fake.catch_phrase(),
        "description": fake.text(),
        "price": float(fake.random_int(min=100, max=10000)),
        "currency": "KES",
        "stock": fake.random_int(min=0, max=1000),
        "category": fake.word()
    }


@pytest.fixture
def sample_order():
    """Sample order data"""
    return {
        "order_id": fake.uuid4(),
        "customer_id": fake.uuid4(),
        "agent_id": fake.uuid4(),
        "items": [
            {
                "product_id": fake.uuid4(),
                "quantity": fake.random_int(min=1, max=10),
                "price": float(fake.random_int(min=100, max=1000))
            }
        ],
        "total_amount": float(fake.random_int(min=500, max=50000)),
        "currency": "KES",
        "status": "pending"
    }


@pytest.fixture
def sample_payment():
    """Sample payment data"""
    return {
        "payment_id": fake.uuid4(),
        "order_id": fake.uuid4(),
        "amount": float(fake.random_int(min=100, max=100000)),
        "currency": "KES",
        "payment_method": fake.random_element(["mpesa", "stripe", "bank_transfer"]),
        "status": "pending"
    }


@pytest.fixture
def api_client():
    """HTTP client for API testing"""
    from httpx import AsyncClient
    return AsyncClient(base_url="http://localhost:8000")


@pytest.fixture
async def async_api_client():
    """Async HTTP client for API testing"""
    from httpx import AsyncClient
    async with AsyncClient(base_url="http://localhost:8000") as client:
        yield client


@pytest.fixture
def mock_workflow_orchestrator():
    """Mock workflow orchestrator"""
    orchestrator = Mock()
    orchestrator.execute_workflow = AsyncMock(return_value={"status": "completed"})
    orchestrator.get_workflow_status = Mock(return_value="completed")
    return orchestrator


@pytest.fixture
def mock_payment_gateway():
    """Mock payment gateway"""
    gateway = Mock()
    gateway.process_payment = AsyncMock(return_value={
        "transaction_id": fake.uuid4(),
        "status": "completed"
    })
    return gateway


@pytest.fixture
def mock_notification_service():
    """Mock notification service"""
    service = Mock()
    service.send_sms = AsyncMock(return_value=True)
    service.send_email = AsyncMock(return_value=True)
    service.send_push = AsyncMock(return_value=True)
    return service


@pytest.fixture(autouse=True)
def reset_mocks():
    """Reset all mocks after each test"""
    yield
    # Cleanup happens here


# Performance testing fixtures
@pytest.fixture
def benchmark_config():
    """Configuration for benchmark tests"""
    return {
        "rounds": 100,
        "warmup_rounds": 10,
        "min_time": 0.001,
        "max_time": 1.0
    }


# Load testing fixtures
@pytest.fixture
def load_test_config():
    """Configuration for load tests"""
    return {
        "users": 100,
        "spawn_rate": 10,
        "duration": "60s",
        "host": "http://localhost:8000"
    }


# Test data generators
class TestDataFactory:
    """Factory for generating test data"""
    
    @staticmethod
    def create_agent(count=1):
        """Generate agent test data"""
        if count == 1:
            return {
                "agent_id": fake.uuid4(),
                "name": fake.name(),
                "email": fake.email(),
                "phone": fake.phone_number()
            }
        return [TestDataFactory.create_agent() for _ in range(count)]
    
    @staticmethod
    def create_product(count=1):
        """Generate product test data"""
        if count == 1:
            return {
                "product_id": fake.uuid4(),
                "name": fake.catch_phrase(),
                "price": float(fake.random_int(min=100, max=10000)),
                "stock": fake.random_int(min=0, max=1000)
            }
        return [TestDataFactory.create_product() for _ in range(count)]
    
    @staticmethod
    def create_order(count=1):
        """Generate order test data"""
        if count == 1:
            return {
                "order_id": fake.uuid4(),
                "customer_id": fake.uuid4(),
                "total_amount": float(fake.random_int(min=500, max=50000)),
                "status": "pending"
            }
        return [TestDataFactory.create_order() for _ in range(count)]


@pytest.fixture
def test_data_factory():
    """Provide test data factory"""
    return TestDataFactory
