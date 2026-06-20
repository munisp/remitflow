# RemitFlow — Multi-Cloud Deployment Guide

## Overview

RemitFlow supports deployment on three cloud providers, all sharing the same Helm chart and application Docker images. The only difference is the underlying infrastructure provisioning (Terraform).

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DEPLOYMENT ARCHITECTURE                            │
│                                                                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │  Terraform   │    │  Terraform   │    │  Terraform   │             │
│  │  (Provider)  │    │  (Provider)  │    │  (Provider)  │             │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘             │
│         │                  │                  │                       │
│         ▼                  ▼                  ▼                       │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐             │
│  │  K8s Cluster │    │  K8s Cluster │    │  K8s Cluster │             │
│  │  (Canada)    │    │  (UK/EU)     │    │  (Africa)    │             │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘             │
│         │                  │                  │                       │
│         └──────────────────┼──────────────────┘                       │
│                            │                                          │
│                    ┌───────▼───────┐                                  │
│                    │  Helm Chart    │  (Same chart on all clusters)    │
│                    │  (remitflow)   │                                  │
│                    └───────┬───────┘                                  │
│                            │                                          │
│              ┌─────────────┼─────────────┐                            │
│              ▼             ▼             ▼                            │
│         ┌────────┐   ┌────────┐   ┌────────┐                        │
│         │  API   │   │ Worker │   │Services│                        │
│         │        │   │(Temprl)│   │(Go/Rs) │                        │
│         └────────┘   └────────┘   └────────┘                        │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Cloudflare (all providers)                                      │ │
│  │  CDN + WAF + GeoDNS + DDoS + SSL                                │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

```bash
# Install tools
brew install terraform helm kubectl

# For Vultr:
brew install vultr-cli

# For DigitalOcean:
brew install doctl

# For AWS:
brew install awscli
```

### Deploy (Any Provider)

```bash
# 1. Choose provider
cd ops/deployment/terraform/vultr    # or /aws, /digitalocean

# 2. Set credentials
export TF_VAR_vultr_api_key="your-api-key"
export TF_VAR_cloudflare_api_token="your-cf-token"
export TF_VAR_cloudflare_zone_id="your-zone-id"

# 3. Initialize and apply
terraform init
terraform plan -var-file=production.tfvars
terraform apply -var-file=production.tfvars

# 4. Configure kubectl
# Vultr:
vultr-cli kubernetes config <cluster-id> > ~/.kube/config
# DigitalOcean:
doctl kubernetes cluster kubeconfig save remitflow-production-ca
# AWS:
aws eks update-kubeconfig --name remitflow-production-ca

# 5. Deploy application via Helm
helm upgrade --install remitflow ops/deployment/helm/remitflow \
  --namespace remitflow --create-namespace \
  --values ops/deployment/helm/remitflow/values.yaml \
  --set api.image.tag=v1.0.0

# 6. Verify
kubectl get pods -n remitflow
curl https://api.remitflow.app/api/health
```

---

## Provider-Specific Instructions

### Vultr

**Signup:** https://www.vultr.com/ (SOC 2 Type II, PCI-DSS compliant)

**Regions available:**
- `yto` — Toronto, Canada (primary)
- `lhr` — London, UK
- `jnb` — Johannesburg, South Africa

**API key:** Account → API → Enable API → Copy key

```bash
export TF_VAR_vultr_api_key="YOUR_VULTR_API_KEY"
cd ops/deployment/terraform/vultr
terraform init && terraform apply -var-file=production.tfvars
```

**Key differences from AWS:**
- VKE control plane is free (EKS charges $0.10/hr = $73/mo per cluster)
- Bandwidth included (6TB/mo free vs AWS egress at $0.09/GB)
- Block storage is NVMe by default
- No NAT gateway charges
- Simpler pricing: instance cost is all-inclusive

**Kubeconfig:**
```bash
vultr-cli kubernetes config $(terraform output -raw k8s_clusters.canada.id)
```

---

### DigitalOcean

**Signup:** https://www.digitalocean.com/ (SOC 2, SOC 3 compliant)

**Regions available:**
- `tor1` — Toronto, Canada
- `lon1` — London, UK
- ❌ No Africa (requires hybrid approach)

**API token:** API → Generate New Token

```bash
export TF_VAR_do_token="YOUR_DO_TOKEN"
cd ops/deployment/terraform/digitalocean
terraform init && terraform apply -var-file=production.tfvars
```

**Key differences from AWS:**
- DOKS control plane is free
- Bandwidth: 5TB/mo included
- Managed databases have built-in connection pooling
- No Africa presence — need colo partner for NDPR

**Kubeconfig:**
```bash
doctl kubernetes cluster kubeconfig save remitflow-production-ca
```

---

### AWS

**Signup:** https://aws.amazon.com/ (SOC 2, PCI-DSS, ISO 27001, HIPAA)

**Regions available:**
- `ca-central-1` — Canada
- `eu-west-1` — Ireland (closest to UK with full services)
- `af-south-1` — Cape Town, South Africa

```bash
export AWS_ACCESS_KEY_ID="YOUR_KEY"
export AWS_SECRET_ACCESS_KEY="YOUR_SECRET"
cd ops/deployment/terraform/aws
terraform init && terraform apply -var-file=production.tfvars
```

**When to choose AWS:**
- Need Shield Advanced DDoS protection (financial requirement from some insurers)
- Need AWS PrivateLink to banking partners who are also on AWS
- Need Graviton/ARM instances for cost optimization at scale
- Need GuardDuty/Macie for compliance automation
- Banking partners require AWS-hosted infrastructure

---

## Cloudflare Configuration (All Providers)

Regardless of infrastructure provider, Cloudflare sits in front for CDN + WAF + GeoDNS.

```bash
# 1. Add domain to Cloudflare
# 2. Get Zone ID from dashboard
# 3. Create API token: Zone → DNS + Firewall + Load Balancing

export TF_VAR_cloudflare_api_token="your-token"
export TF_VAR_cloudflare_zone_id="your-zone-id"
```

**What Cloudflare provides:**
- **CDN**: Static assets cached at 300+ edge locations globally
- **WAF**: OWASP CRS + Cloudflare Managed Rules (SQLi, XSS, etc.)
- **GeoDNS**: Route Canadian users → Toronto, African users → Johannesburg
- **DDoS**: Unmetered DDoS protection (free on all plans)
- **SSL**: Full strict mode with origin certificates
- **Rate Limiting**: Per-IP, per-path request limits

**Recommended plan:** Pro ($20/mo) or Business ($200/mo for advanced WAF rules)

---

## Data Residency Routing

The application enforces data residency at the database level. The Helm chart configures region-aware connection strings:

```yaml
# values-production-ca.yaml
env:
  DATABASE_URL: "postgres://...@primary-ca:5432/remitflow"  # Read/write
  DATABASE_REPLICA_URL: ""  # Same region, no replica needed

# values-production-uk.yaml
env:
  DATABASE_URL: "postgres://...@primary-ca:5432/remitflow"  # Write to primary
  DATABASE_REPLICA_URL: "postgres://...@replica-uk:5432/remitflow"  # Local reads

# values-production-af.yaml
env:
  DATABASE_URL: "postgres://...@primary-ca:5432/remitflow"  # Write to primary
  DATABASE_REPLICA_URL: "postgres://...@replica-af:5432/remitflow"  # Local reads
  DATABASE_RESIDENCY_URL: "postgres://...@residency-af:5432/remitflow_pii"  # Nigerian PII
```

The `dataResidency` module (Phase 2) routes PII storage to the correct regional database based on the user's jurisdiction.

---

## Self-Hosted Components (All Providers)

These must be deployed via Helm/K8s regardless of cloud provider:

| Component | Helm Chart Source | Notes |
|-----------|------------------|-------|
| **TigerBeetle** | Self-managed (StatefulSet) | No managed offering exists |
| **Kafka/Redpanda** | Bitnami or Redpanda Helm chart | Redpanda recommended (less resources) |
| **Vault** | HashiCorp official Helm chart | 3-node HA with Raft storage |
| **Temporal** | Temporal Helm chart | Or use Temporal Cloud ($200/mo) |
| **Prometheus** | kube-prometheus-stack | Or use Grafana Cloud (free tier) |
| **Grafana** | Included in kube-prometheus-stack | Or use Grafana Cloud |

---

## Disaster Recovery

### Cross-Region Failover

```bash
# If Canada region fails:

# 1. Promote UK PostgreSQL replica to primary
# Vultr:
vultr-cli database update <replica-id> --promote-to-primary
# DigitalOcean:
doctl databases promote <replica-id>
# AWS:
aws rds failover-db-cluster --db-cluster-identifier remitflow-production-ca

# 2. Update Cloudflare to route all traffic to UK
# (automatic if health check fails — Cloudflare LB handles this)

# 3. Scale UK cluster
kubectl scale deployment remitflow-api --replicas=6 -n remitflow
```

### Backup Strategy

| Data | Frequency | Retention | Storage |
|------|-----------|-----------|---------|
| PostgreSQL | Hourly snapshots | 35 days | Provider managed |
| TigerBeetle | Every 6 hours | 90 days | Object storage |
| Kafka topics | Continuous replication | 7 days in-cluster, 90 days cold | Object storage |
| KYC documents | At upload (immutable) | 7 years | Object storage (versioned) |
| Vault | Hourly (encrypted) | 90 days | Cross-region object storage |

---

## Migration Between Providers

The application layer is fully portable. To migrate from one provider to another:

```bash
# 1. Stand up new infrastructure
cd ops/deployment/terraform/vultr  # new provider
terraform apply

# 2. Migrate PostgreSQL data
pg_dump -Fc remitflow | pg_restore -d remitflow_new

# 3. Deploy application to new cluster
helm upgrade --install remitflow ops/deployment/helm/remitflow \
  --set api.image.tag=v1.0.0

# 4. Update Cloudflare to point to new cluster IPs
# (Terraform handles this automatically)

# 5. Verify and decommission old infrastructure
terraform destroy  # old provider directory
```

Estimated migration time: 2-4 hours (database size dependent).
