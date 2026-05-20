# TigerBeetle Integration for Remittance Platform

This directory contains the complete TigerBeetle integration with both Zig (primary) and Go (edge) implementations, providing high-performance accounting capabilities with bidirectional synchronization.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TigerBeetle Architecture                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────┐  │
│  │  TigerBeetle    │    │  Sync Manager   │    │  Dashboard  │  │
│  │  Zig Primary    │◄──►│   (Python)      │◄──►│   (React)   │  │
│  │   (Python)      │    │                 │    │             │  │
│  └─────────────────┘    └─────────────────┘    └─────────────┘  │
│           ▲                       ▲                             │
│           │                       │                             │
│           ▼                       ▼                             │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │   PostgreSQL    │    │     Redis       │                    │
│  │   Database      │    │     Cache       │                    │
│  └─────────────────┘    └─────────────────┘                    │
│           ▲                       ▲                             │
│           │                       │                             │
│           └───────────┬───────────┘                             │
│                       │                                         │
│           ┌───────────▼───────────┐                             │
│           │                       │                             │
│  ┌─────────────────┐    ┌─────────────────┐                    │
│  │ TigerBeetle Go  │    │ TigerBeetle Go  │                    │
│  │   Edge 1        │    │   Edge 2        │                    │
│  │  (SQLite)       │    │  (SQLite)       │                    │
│  └─────────────────┘    └─────────────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. TigerBeetle Zig Primary Service (`zig-primary/`)
- **High-performance accounting engine** using TigerBeetle Zig
- **REST API interface** for account and transfer operations
- **PostgreSQL integration** for metadata and sync events
- **Redis pub/sub** for real-time synchronization
- **Automatic TigerBeetle binary download** and setup

**Key Features:**
- Double-entry bookkeeping with ACID guarantees
- Nanosecond timestamp precision
- Account creation and balance management
- Transfer processing with validation
- Sync event generation and processing
- Health monitoring and metrics

### 2. TigerBeetle Go Edge Services (`go-edge/`)
- **Offline-capable edge instances** for remote operations
- **SQLite local storage** for offline resilience
- **Bidirectional synchronization** with Zig primary
- **Load balancing** support with multiple instances
- **Real-time sync** via Redis pub/sub

**Key Features:**
- Offline transaction processing
- Local account and transfer management
- Automatic sync when connectivity restored
- Conflict resolution strategies
- Edge-specific metrics and monitoring

### 3. TigerBeetle Sync Manager (`sync-manager/`)
- **Orchestrates synchronization** between all instances
- **Node registration and discovery**
- **Event-driven sync processing**
- **Retry mechanisms** for failed syncs
- **Comprehensive monitoring** and metrics

**Key Features:**
- Multi-node synchronization orchestration
- Heartbeat monitoring for all nodes
- Sync event processing and distribution
- Failure detection and recovery
- Performance metrics and reporting

## Quick Start

### 1. Start All Services
```bash
cd tigerbeetle-services
docker-compose up -d
```

### 2. Verify Services
```bash
# Check all services are healthy
docker-compose ps

# Check TigerBeetle Zig Primary
curl http://localhost:8030/health

# Check TigerBeetle Go Edge 1
curl http://localhost:8031/health

# Check TigerBeetle Go Edge 2
curl http://localhost:8033/health

# Check Sync Manager
curl http://localhost:8032/health
```

### 3. Register Edge Nodes with Sync Manager
```bash
# Register Edge 1
curl -X POST http://localhost:8032/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "id": "edge-1",
    "type": "go-edge",
    "url": "http://tigerbeetle-go-edge-1:8031"
  }'

# Register Edge 2
curl -X POST http://localhost:8032/nodes/register \
  -H "Content-Type: application/json" \
  -d '{
    "id": "edge-2",
    "type": "go-edge",
    "url": "http://tigerbeetle-go-edge-2:8031"
  }'
```

## API Usage Examples

### Account Operations

#### Create Accounts
```bash
# Create accounts on Zig Primary
curl -X POST http://localhost:8030/accounts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 1001,
      "user_data": 12345,
      "ledger": 1,
      "code": 1,
      "flags": 0
    },
    {
      "id": 1002,
      "user_data": 12346,
      "ledger": 1,
      "code": 1,
      "flags": 0
    }
  ]'

# Create accounts on Edge 1
curl -X POST http://localhost:8031/accounts \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 2001,
      "user_data": 22345,
      "ledger": 1,
      "code": 1,
      "flags": 0
    }
  ]'
```

#### Get Account Balance
```bash
# Get balance from Zig Primary
curl http://localhost:8030/accounts/1001

# Get balance from Edge 1
curl http://localhost:8031/accounts/2001
```

### Transfer Operations

#### Create Transfers
```bash
# Create transfer on Zig Primary
curl -X POST http://localhost:8030/transfers \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 3001,
      "debit_account_id": 1001,
      "credit_account_id": 1002,
      "amount": 10000,
      "ledger": 1,
      "code": 1,
      "flags": 0
    }
  ]'

# Create transfer on Edge 1
curl -X POST http://localhost:8031/transfers \
  -H "Content-Type: application/json" \
  -d '[
    {
      "id": 4001,
      "debit_account_id": 2001,
      "credit_account_id": 1001,
      "amount": 5000,
      "ledger": 1,
      "code": 1,
      "flags": 0
    }
  ]'
```

### Synchronization Operations

#### Check Sync Status
```bash
# Get sync status from Sync Manager
curl http://localhost:8032/sync/status

# Get sync events
curl http://localhost:8032/sync/events?limit=10

# Trigger manual sync
curl -X POST http://localhost:8032/sync/trigger
```

#### Monitor Nodes
```bash
# Get all registered nodes
curl http://localhost:8032/nodes

# Get specific node details
curl http://localhost:8032/nodes/edge-1

# Get comprehensive metrics
curl http://localhost:8032/metrics
```

## Monitoring and Metrics

### Service Endpoints
- **Zig Primary**: http://localhost:8030/metrics
- **Edge 1**: http://localhost:8031/metrics
- **Edge 2**: http://localhost:8033/metrics
- **Sync Manager**: http://localhost:8032/metrics
- **Load Balancer**: http://localhost:8035/health

### Key Metrics
- **Account Count**: Total accounts across all instances
- **Transfer Count**: Total transfers processed
- **Sync Events**: Pending, processed, and failed sync events
- **Node Status**: Online/offline status of all nodes
- **Error Rates**: Synchronization error percentages
- **Performance**: Average sync times and throughput

## High Availability Features

### Automatic Failover
- **Edge Offline Mode**: Continue operations when primary unavailable
- **Sync Recovery**: Automatic sync when connectivity restored
- **Load Balancing**: Multiple edge instances with Nginx load balancer
- **Health Checks**: Continuous health monitoring with Docker

### Data Consistency
- **ACID Transactions**: TigerBeetle guarantees on Zig primary
- **Eventual Consistency**: Edge instances sync with primary
- **Conflict Resolution**: Timestamp-based conflict resolution
- **Audit Trail**: Complete transaction history and sync events

## Scaling Configuration

### Horizontal Scaling
```yaml
# Add more edge instances
tigerbeetle-go-edge-3:
  build:
    context: ./go-edge
  environment:
    - EDGE_ID=edge-3
    - PORT=8031
  ports:
    - "8036:8031"
```

### Performance Tuning
```yaml
# Adjust sync intervals
environment:
  - SYNC_INTERVAL=2        # Faster sync (2 seconds)
  - HEARTBEAT_INTERVAL=15  # More frequent heartbeats
  - MAX_RETRY_ATTEMPTS=5   # More retry attempts
```

## Security Features

### Network Security
- **Internal Docker Network**: Services communicate on private network
- **TLS Support**: Ready for TLS termination at load balancer
- **Authentication**: JWT token support in API endpoints
- **Rate Limiting**: Built-in rate limiting for API endpoints

### Data Security
- **Encrypted Storage**: Database encryption at rest
- **Secure Communication**: Redis AUTH and PostgreSQL SSL
- **Audit Logging**: Complete audit trail in database
- **Access Control**: Role-based access control integration

## Troubleshooting

### Common Issues

#### TigerBeetle Binary Download Fails
```bash
# Check logs
docker logs tigerbeetle-zig-primary

# Manual binary installation
docker exec -it tigerbeetle-zig-primary /bin/bash
# Download and install TigerBeetle manually
```

#### Sync Issues
```bash
# Check sync manager logs
docker logs tigerbeetle-sync-manager

# Check Redis connectivity
docker exec -it tigerbeetle-redis redis-cli ping

# Force sync
curl -X POST http://localhost:8032/sync/trigger
```

#### Database Connection Issues
```bash
# Check PostgreSQL logs
docker logs tigerbeetle-postgres

# Test database connection
docker exec -it tigerbeetle-postgres psql -U banking_user -d remittance -c "SELECT 1;"
```

### Log Locations
- **Zig Primary**: `docker logs tigerbeetle-zig-primary`
- **Go Edge**: `docker logs tigerbeetle-go-edge-1`
- **Sync Manager**: `docker logs tigerbeetle-sync-manager`
- **PostgreSQL**: `docker logs tigerbeetle-postgres`
- **Redis**: `docker logs tigerbeetle-redis`

## Integration with Remittance Platform

### Transaction Service Integration
```python
# Example integration with transaction service
import httpx

async def create_tigerbeetle_transfer(debit_account, credit_account, amount):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://tigerbeetle-zig-primary:8030/transfers",
            json=[{
                "id": generate_transfer_id(),
                "debit_account_id": debit_account,
                "credit_account_id": credit_account,
                "amount": amount,
                "ledger": 1,
                "code": 1,
                "flags": 0
            }]
        )
        return response.json()
```

### Account Management Integration
```python
# Example account creation
async def create_customer_account(customer_id):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://tigerbeetle-zig-primary:8030/accounts",
            json=[{
                "id": customer_id,
                "user_data": customer_id,
                "ledger": 1,
                "code": 1,  # Customer account code
                "flags": 0
            }]
        )
        return response.json()
```

## Performance Benchmarks

### Expected Performance
- **TigerBeetle Zig**: 1M+ transactions per second
- **Go Edge**: 10K+ transactions per second per instance
- **Sync Latency**: <100ms for real-time sync
- **Offline Capacity**: Unlimited (SQLite storage)

### Load Testing
```bash
# Install load testing tools
pip install locust

# Run load tests
locust -f load_test.py --host=http://localhost:8030
```

This TigerBeetle integration provides a complete, production-ready accounting system with high performance, reliability, and scalability for the Remittance Platform.
