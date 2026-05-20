#!/usr/bin/env python3
"""
Create Service Architecture Diagram using Mermaid
"""

def create_service_architecture_mermaid():
    """Create service architecture diagram in Mermaid format"""
    
    service_arch_mmd = '''graph TB
    subgraph "🌐 External Access"
        Users[Users<br/>Nigeria & Brazil]
        Mobile[Mobile Apps]
        Web[Web Portal]
    end
    
    subgraph "🔒 Load Balancer & SSL"
        Nginx[Nginx Load Balancer<br/>Ports 80/443<br/>SSL Termination]
    end
    
    subgraph "🌐 API Gateway Layer"
        Gateway[Enhanced API Gateway<br/>Port 8000<br/>Go Service<br/>Intelligent Routing]
    end
    
    subgraph "🇧🇷 PIX Integration Services"
        PIXGateway[PIX Gateway<br/>Port 5001<br/>Go Service<br/>BCB Integration]
        BRLLiquidity[BRL Liquidity Manager<br/>Port 5002<br/>Python Service<br/>Exchange Rates]
        Compliance[Brazilian Compliance<br/>Port 5003<br/>Go Service<br/>AML/CFT]
        SupportPT[Customer Support PT<br/>Port 5004<br/>Python Service<br/>Portuguese Support]
        Orchestrator[Integration Orchestrator<br/>Port 5005<br/>Go Service<br/>Workflow Management]
        DataSync[Data Sync Service<br/>Port 5006<br/>Python Service<br/>Cross-Platform Sync]
    end
    
    subgraph "⚡ Enhanced Platform Services"
        TigerBeetle[Enhanced TigerBeetle<br/>Port 3011<br/>Go Service<br/>1M+ TPS Ledger]
        Notifications[Enhanced Notifications<br/>Port 3002<br/>Python Service<br/>Multi-Language]
        UserMgmt[Enhanced User Management<br/>Port 3001<br/>Go Service<br/>Multi-Country KYC]
        Stablecoin[Enhanced Stablecoin<br/>Port 3003<br/>Python Service<br/>BRL Liquidity]
        GNN[Enhanced GNN<br/>Port 4004<br/>Python Service<br/>AI Fraud Detection]
    end
    
    subgraph "🗄️ Data Layer"
        PostgreSQL[(PostgreSQL Primary<br/>Port 5432<br/>10K+ TPS)]
        PostgreSQLReplica[(PostgreSQL Replica<br/>Port 5433<br/>Read Scaling)]
        Redis[(Redis Cluster<br/>Port 6379<br/>100K+ ops/sec)]
    end
    
    subgraph "📊 Monitoring Layer"
        Prometheus[Prometheus<br/>Port 9090<br/>Metrics Collection]
        Grafana[Grafana<br/>Port 3000<br/>Dashboards]
    end
    
    subgraph "🏦 External Systems"
        BCB[Brazilian Central Bank<br/>PIX System]
        ExchangeAPIs[Exchange Rate APIs<br/>Real-time Rates]
        AMLDatabases[AML/CFT Databases<br/>Compliance Screening]
        BrazilianBanks[Brazilian Banks<br/>PIX Network]
    end
    
    %% User connections
    Users --> Mobile
    Users --> Web
    Mobile --> Nginx
    Web --> Nginx
    
    %% Load balancer routing
    Nginx --> Gateway
    
    %% API Gateway intelligent routing
    Gateway --> Orchestrator
    Gateway --> PIXGateway
    Gateway --> BRLLiquidity
    Gateway --> UserMgmt
    
    %% PIX Integration orchestration
    Orchestrator --> PIXGateway
    Orchestrator --> BRLLiquidity
    Orchestrator --> Compliance
    Orchestrator --> SupportPT
    Orchestrator --> DataSync
    
    %% Enhanced platform integration
    Orchestrator --> TigerBeetle
    Orchestrator --> Notifications
    Orchestrator --> UserMgmt
    Orchestrator --> Stablecoin
    Orchestrator --> GNN
    
    %% External system connections
    PIXGateway <--> BCB
    PIXGateway <--> BrazilianBanks
    BRLLiquidity <--> ExchangeAPIs
    Compliance <--> AMLDatabases
    
    %% Data layer connections
    PIXGateway --> PostgreSQL
    BRLLiquidity --> PostgreSQL
    Compliance --> PostgreSQL
    Orchestrator --> PostgreSQL
    TigerBeetle --> PostgreSQL
    UserMgmt --> PostgreSQL
    Stablecoin --> PostgreSQL
    GNN --> PostgreSQL
    
    %% Read replica usage
    BRLLiquidity --> PostgreSQLReplica
    GNN --> PostgreSQLReplica
    Grafana --> PostgreSQLReplica
    
    %% Cache layer
    PIXGateway --> Redis
    BRLLiquidity --> Redis
    Gateway --> Redis
    UserMgmt --> Redis
    Orchestrator --> Redis
    
    %% Monitoring connections
    PIXGateway -.-> Prometheus
    BRLLiquidity -.-> Prometheus
    Compliance -.-> Prometheus
    SupportPT -.-> Prometheus
    Orchestrator -.-> Prometheus
    DataSync -.-> Prometheus
    TigerBeetle -.-> Prometheus
    Notifications -.-> Prometheus
    UserMgmt -.-> Prometheus
    Stablecoin -.-> Prometheus
    GNN -.-> Prometheus
    Gateway -.-> Prometheus
    
    Prometheus --> Grafana
    
    %% Styling
    classDef pixService fill:#e1f5fe,stroke:#01579b,stroke-width:3px,color:#000
    classDef enhancedService fill:#f3e5f5,stroke:#4a148c,stroke-width:3px,color:#000
    classDef infrastructure fill:#e8f5e8,stroke:#1b5e20,stroke-width:3px,color:#000
    classDef external fill:#fff3e0,stroke:#e65100,stroke-width:3px,color:#000
    classDef monitoring fill:#fce4ec,stroke:#880e4f,stroke-width:3px,color:#000
    classDef gateway fill:#e3f2fd,stroke:#0d47a1,stroke-width:4px,color:#000
    
    class PIXGateway,BRLLiquidity,Compliance,SupportPT,Orchestrator,DataSync pixService
    class TigerBeetle,Notifications,UserMgmt,Stablecoin,GNN enhancedService
    class PostgreSQL,PostgreSQLReplica,Redis,Nginx infrastructure
    class BCB,ExchangeAPIs,AMLDatabases,BrazilianBanks external
    class Prometheus,Grafana monitoring
    class Gateway gateway
'''
    
    with open("/home/ubuntu/pix_service_architecture.mmd", "w") as f:
        f.write(service_arch_mmd)
    
    print("✅ Service architecture diagram created")

if __name__ == "__main__":
    create_service_architecture_mermaid()

