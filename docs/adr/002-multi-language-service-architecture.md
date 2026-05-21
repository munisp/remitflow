# ADR-002: Multi-Language Microservice Architecture

## Status
Accepted

## Context
RemitFlow uses TypeScript (Node.js) as its primary language for the API server and frontend. However, certain domains benefit from language-specific strengths:
- **Go**: High-throughput HTTP services with low memory footprint (FX aggregation, health checking)
- **Rust**: Zero-cost abstractions for financial calculations (fee engine) with maximum correctness guarantees
- **Python**: Rapid development for workflow services (refunds, compliance) with rich ecosystem for ML/AI

## Decision
Use a polyglot architecture:
- **TypeScript/Node.js**: API server (tRPC), frontend (React), business logic
- **Go**: FX rate aggregator, health check aggregator, BVN/NIN verification, goAML integration
- **Rust**: Fee calculation engine, liveness proxy, sanctions batch rescreener
- **Python**: Refund engine, compliance engine, KYC event consumer, deep KYB analysis

All services communicate via:
1. HTTP/REST for synchronous operations
2. Kafka for asynchronous events
3. gRPC for high-performance internal calls (transfer engine)

## Consequences
- **Better**: Each service uses the best tool for its domain
- **Better**: Services can be deployed/scaled independently
- **Trade-off**: Higher operational complexity (multiple build toolchains)
- **Trade-off**: Need polyglot CI/CD pipeline
- **Mitigation**: Consolidated docker-compose with profiles
