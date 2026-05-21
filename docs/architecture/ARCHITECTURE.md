# RemitFlow Architecture

## System Overview

RemitFlow is a polyglot microservices platform for African remittances, built with:
- **TypeScript/Node.js**: API server (tRPC), 317 frontend pages (React)
- **Go**: FX aggregation, health monitoring, BVN/NIN verification, goAML integration
- **Rust**: Fee engine, idempotency service, audit service, sanctions re-screening
- **Python**: Refund engine, synthetic monitoring, KYC liveness, compliance service

## Architecture Diagram

```mermaid
graph TB
    subgraph "Client Layer"
        WEB[React SPA<br/>317 pages]
        PWA[PWA + USSD]
        SDK[Checkout SDK<br/>White-label]
    end

    subgraph "API Gateway"
        TRPC[tRPC Server<br/>382 procedures]
        CSP[CSP + Security Headers]
        RL[Rate Limiter]
        CORS[CORS]
    end

    subgraph "Middleware"
        AUTH[Auth + Session]
        CSRF[CSRF Protection]
        RBAC[RBAC Enforcement]
        AUDIT[Audit Logger]
        METRICS[Business Metrics]
        CB[Circuit Breaker]
        IDEM[Idempotency]
    end

    subgraph "Go Services"
        FX[FX Rate Aggregator<br/>:8082]
        HEALTH[Health Aggregator<br/>:8083]
        BVN[BVN/NIN Verifier<br/>:8085]
        GOAML[goAML Integration<br/>:8086]
    end

    subgraph "Rust Services"
        FEE[Fee Engine<br/>:8084]
        IDKEY[Idempotency Service<br/>:8090]
        AUDSVC[Audit Service<br/>:8091]
        SANCT[Sanctions Rescreener<br/>:8092]
    end

    subgraph "Python Services"
        REFUND[Refund Engine<br/>:8087]
        SYNTH[Synthetic Monitor<br/>:8088]
        LIVENESS[KYC Liveness<br/>:8089]
        COMPLY[Compliance Service<br/>:8093]
        KYCEVENT[KYC Event Consumer<br/>:8094]
    end

    subgraph "Data Layer"
        PG[(PostgreSQL<br/>406 tables)]
        REDIS[(Redis<br/>Cache + Rate Limit)]
        S3[S3<br/>Documents + Media]
    end

    subgraph "Event Bus"
        KAFKA[Kafka<br/>15+ topics]
        TEMPORAL[Temporal<br/>KYC Workflows]
    end

    subgraph "Observability"
        PROM[Prometheus]
        GRAF[Grafana]
        SENTRY[Sentry]
        OTEL[OpenTelemetry]
    end

    WEB --> TRPC
    PWA --> TRPC
    SDK --> TRPC

    TRPC --> AUTH --> CSRF --> RBAC --> AUDIT
    AUDIT --> METRICS --> CB

    TRPC --> FX
    TRPC --> FEE
    TRPC --> BVN
    TRPC --> REFUND
    TRPC --> GOAML
    TRPC --> LIVENESS

    TRPC --> PG
    TRPC --> REDIS
    TRPC --> S3
    TRPC --> KAFKA
    TRPC --> TEMPORAL

    KAFKA --> KYCEVENT
    KYCEVENT --> TEMPORAL

    PROM --> GRAF
    TRPC --> SENTRY
    TRPC --> OTEL
```

## Data Flow: Transfer

```mermaid
sequenceDiagram
    participant U as User
    participant API as tRPC API
    participant FX as Go FX Service
    participant FEE as Rust Fee Engine
    participant CB as Circuit Breaker
    participant DB as PostgreSQL
    participant K as Kafka
    participant T as Temporal

    U->>API: transfer.send(amount, currency, beneficiary)
    API->>API: Validate input (Zod)
    API->>API: Check RBAC + KYC tier
    API->>FX: Get live rate
    FX-->>API: Rate + lock ID
    API->>FEE: Calculate fee(amount, corridor)
    FEE-->>API: Fee breakdown
    API->>CB: Check payment rail health
    CB-->>API: OK (circuit closed)
    API->>DB: INSERT transaction (pending)
    API->>K: publish(payment.initiated)
    K->>T: Start transfer workflow
    T->>DB: UPDATE transaction (processing)
    T->>T: Execute payment via rail
    T->>DB: UPDATE transaction (completed)
    T->>K: publish(payment.completed)
    API-->>U: Transfer initiated (tracking ID)
```

## Service Boundaries

| Domain | Language | Why |
|--------|----------|-----|
| API + Frontend | TypeScript | Type safety across client/server boundary |
| FX Aggregation | Go | Low-latency concurrent HTTP calls to rate providers |
| Fee Calculation | Rust | Sub-millisecond math, zero-allocation hot path |
| Refund Processing | Python | Complex business rules, rapid iteration |
| KYC Liveness | Python | ML model integration (MiniFASNet, PaddleOCR) |
| Audit Service | Rust | High-throughput append-only log, tamper detection |
| Sanctions | Rust | OFAC list matching — performance-critical fuzzy search |

## Database Schema

- **262 tables** defined in Drizzle ORM schema
- **50+ relations** for type-safe JOINs
- **Row-Level Security** on 6 sensitive tables
- **Full-text search** via GIN indexes on 6 tables
- **Soft deletes** on 10 critical tables

## Deployment

- **Kubernetes (EKS)**: 3-20 nodes, HPA auto-scaling
- **Terraform**: Full IaC for EKS, RDS Multi-AZ, ElastiCache, S3, VPC
- **GitOps**: Staging → Production via GitHub Actions
- **Docker**: 72+ services with health checks
