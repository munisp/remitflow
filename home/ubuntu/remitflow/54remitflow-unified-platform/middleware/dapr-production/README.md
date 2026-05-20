# Dapr Production Implementation

Complete Dapr (Distributed Application Runtime) implementation for the Nigerian Remittance Platform.

## Overview

This implementation provides a production-ready Dapr infrastructure with:
- **State Management** - Redis and PostgreSQL state stores
- **Pub/Sub Messaging** - Kafka-based event streaming
- **Service Invocation** - Service-to-service communication
- **Actors** - Stateful transaction and user actors
- **Secrets Management** - Kubernetes secrets integration
- **Bindings** - TigerBeetle integration
- **Observability** - Zipkin tracing and Prometheus metrics
- **Resiliency** - Circuit breakers, retries, timeouts

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Dapr Control Plane                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Placement │  │  Sentry  │  │Operator  │  │Dashboard │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼────┐           ┌────▼────┐          ┌────▼────┐
   │ Payment │           │  Fraud  │          │  User   │
   │ Service │           │Detection│          │ Service │
   │  +Dapr  │           │  +Dapr  │          │  +Dapr  │
   └────┬────┘           └────┬────┘          └────┬────┘
        │                     │                     │
   ┌────▼─────────────────────▼─────────────────────▼────┐
   │              Dapr Building Blocks                    │
   │  State│PubSub│Invocation│Actors│Bindings│Secrets   │
   └──────────────────────────────────────────────────────┘
        │         │         │         │         │
   ┌────▼────┐┌──▼──┐┌─────▼────┐┌──▼──┐┌─────▼────┐
   │  Redis  ││Kafka││PostgreSQL││ K8s ││TigerBeetle│
   └─────────┘└─────┘└──────────┘└─────┘└──────────┘
```

## Components

### 1. State Management

**Redis State Store** (`components/statestore-redis.yaml`)
- High-performance caching
- Transaction state
- Session management

**PostgreSQL State Store** (`components/statestore-postgresql.yaml`)
- Persistent metadata
- User profiles
- Compliance records

### 2. Pub/Sub Messaging

**Kafka Pub/Sub** (`components/pubsub-kafka.yaml`)
- Event streaming
- Transaction events
- Fraud alerts
- User notifications

### 3. Service Invocation

**Service-to-Service Communication**
- Payment Service
- Fraud Detection
- User Service
- API Gateway

### 4. Actors

**Transaction Actor**
- Stateful transaction processing
- Automatic timeout handling
- Retry logic

**User Actor**
- User state management
- Balance tracking
- Transaction history

### 5. Bindings

**TigerBeetle Binding** (`components/binding-tigerbeetle.yaml`)
- Financial transactions
- Account management
- Transfer processing

## Installation

### Prerequisites

```bash
# Install Dapr CLI
wget -q https://raw.githubusercontent.com/dapr/cli/master/install/install.sh -O - | /bin/bash

# Initialize Dapr
dapr init

# Verify installation
dapr --version
```

### Local Development

```bash
# Install Python dependencies
pip install -r requirements.txt

# Start services with Docker Compose
docker-compose up -d

# Run tests
pytest tests/ -v
```

### Kubernetes Deployment

```bash
# Install Dapr on Kubernetes
dapr init -k

# Deploy services
kubectl apply -f k8s/

# Verify deployment
kubectl get pods -n remittance-platform
```

## Usage

### State Management

```python
from src.state.state_manager import DaprStateManager

# Save state
state_manager = DaprStateManager()
await state_manager.save_state(
    key='transaction:txn_123',
    value={'amount': 50000, 'status': 'PENDING'}
)

# Get state
transaction = await state_manager.get_state('transaction:txn_123')

# Delete state
await state_manager.delete_state('transaction:txn_123')
```

### Pub/Sub Messaging

```python
from src.pubsub.pubsub_manager import RemittancePubSubService

# Publish event
pubsub_service = RemittancePubSubService()
await pubsub_service.publish_transaction_created(
    transaction_id='txn_123',
    transaction_data={'amount': 50000}
)

# Subscribe to events
@pubsub_service.manager.subscribe(topic='transactions.created')
async def handle_transaction(data):
    print(f"Transaction created: {data}")
```

### Service Invocation

```python
from src.invocation.service_invocation import PaymentServiceClient

# Invoke payment service
payment_client = PaymentServiceClient()
result = await payment_client.initiate_transfer(
    sender_id='user_1',
    receiver_id='user_2',
    amount=50000.0,
    currency='NGN',
    corridor='PAPSS'
)
```

### Actors

```python
from dapr.actor import ActorProxy, ActorId
from src.actors.transaction_actor import TransactionActor

# Create actor proxy
actor_id = ActorId('txn_123')
proxy = ActorProxy.create('TransactionActor', actor_id, TransactionActor)

# Initiate transaction
result = await proxy.initiate_transaction({
    'amount': 50000,
    'currency': 'NGN'
})

# Get status
status = await proxy.get_status()
```

## Configuration

### Resiliency

Configured in `components/resiliency.yaml`:
- **Retries**: Exponential backoff with max 10 attempts
- **Circuit Breakers**: Trip after 3 consecutive failures
- **Timeouts**: 5s default, 30s for long operations

### Security

- **mTLS**: Enabled for all service-to-service communication
- **Access Control**: Trust domain-based authorization
- **Secrets**: Kubernetes secrets integration

### Observability

- **Tracing**: Zipkin integration (100% sampling)
- **Metrics**: Prometheus metrics export
- **Logging**: Structured JSON logging

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run specific test
pytest tests/test_dapr_integration.py::TestDaprStateManagement -v

# Run with coverage
pytest tests/ --cov=src --cov-report=html
```

## Monitoring

### Metrics

Access Prometheus metrics:
```bash
curl http://localhost:9090/metrics
```

### Tracing

Access Zipkin UI:
```
http://localhost:9411
```

### Dashboard

Access Dapr dashboard:
```bash
dapr dashboard -k
```

## Production Deployment

### Resource Requirements

- **CPU**: 2 cores per service
- **Memory**: 2 GB per service
- **Storage**: 10 GB for state stores

### High Availability

- **Placement**: 3 replicas
- **Services**: 2+ replicas each
- **State Stores**: Redis Sentinel, PostgreSQL replication

### Scaling

```bash
# Scale payment service
kubectl scale deployment payment-service --replicas=5 -n remittance-platform

# Autoscaling
kubectl autoscale deployment payment-service --cpu-percent=70 --min=2 --max=10
```

## Troubleshooting

### Check Dapr sidecar logs
```bash
kubectl logs <pod-name> -c daprd -n remittance-platform
```

### Check component status
```bash
dapr components -k -n remittance-platform
```

### Debug service invocation
```bash
dapr invoke --app-id payment-service --method health
```

## Integration with Platform

### TigerBeetle Integration
- Dapr binding for financial transactions
- Event-driven account updates
- Real-time balance synchronization

### PostgreSQL Integration
- State store for metadata
- CDC events to Kafka
- Compliance record storage

### Kafka Integration
- Pub/sub for all events
- Event sourcing
- Audit trail

## Performance

- **State Operations**: < 10ms
- **Pub/Sub Latency**: < 50ms
- **Service Invocation**: < 20ms
- **Actor Operations**: < 15ms

## Security

- mTLS encryption for all traffic
- JWT token validation
- API key authentication
- Role-based access control

## License

Proprietary - Nigerian Remittance Platform

## Support

For issues or questions, contact the platform team.

