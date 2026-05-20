# Remittance Platform Documentation Index

This index provides quick access to the essential documentation for the Remittance Platform.

## Essential Guides

### 1. Getting Started
- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - How to deploy the platform
- [API Documentation](./API_DOCUMENTATION.md) - API reference and endpoints

### 2. Operations
- [Operations Runbook](./OPERATIONS_RUNBOOK.md) - Day-to-day operations guide
- [Monitoring Guide](./MONITORING_GUIDE.md) - Monitoring and alerting setup

### 3. Architecture
- [Executive Summary](./EXECUTIVE_SUMMARY.md) - Platform overview
- [Data Exchange Specification](./DATA_EXCHANGE_SPECIFICATION.md) - Data formats and protocols

### 4. Security
- [Security Vulnerabilities](./CRITICAL_SECURITY_VULNERABILITIES.md) - Security considerations
- [Security Scanning Tools](./TOP_3_SECURITY_SCANNING_TOOLS.md) - Security tooling

### 5. Testing
- [Test Results](./test-results/) - Test execution reports
- [E2E Testing Guide](./E2E_TESTING_SETUP_GUIDE.md) - End-to-end testing setup

### 6. Features
- [Platform Features Catalog](./COMPLETE_PLATFORM_FEATURES_CATALOG.md) - Complete feature list
- [Developing Countries Features](./DEVELOPING_COUNTRIES_FEATURES.md) - Features for emerging markets

## Infrastructure Documentation

### High Availability Components
Located in `infrastructure/ha-components/`:
- Kafka - Message streaming
- Redis - Caching and session management
- Temporal - Workflow orchestration
- Keycloak - Identity and access management
- APISIX - API gateway
- Dapr - Service mesh
- Fluvio - Real-time streaming
- PostgreSQL - Primary database
- TigerBeetle - Financial ledger
- Permify - Authorization service
- Lakehouse - Data analytics
- OpenAppSec - Web application firewall

### Secret Management
See `infrastructure/ha-components/secret-management/` for:
- External Secrets Operator configuration
- Platform secrets definitions

## Archive

Historical documentation and detailed reports have been moved to the `archive/` directory.
These documents are preserved for reference but are not required for day-to-day operations.

## Quick Links

| Resource | Description |
|----------|-------------|
| [API Docs](./API_DOCUMENTATION.md) | REST API reference |
| [Deployment](./DEPLOYMENT_GUIDE.md) | Deployment instructions |
| [Operations](./OPERATIONS_RUNBOOK.md) | Operations guide |
| [Test Results](./test-results/) | Test execution reports |

---

*Last updated: December 2024*
