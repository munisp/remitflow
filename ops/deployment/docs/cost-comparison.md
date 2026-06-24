# RemitFlow — Cloud Provider Cost Comparison

## Production Requirements

- **3 regions**: Canada (primary), UK/EU, Africa
- **Per region**: 3-node K8s cluster (4 vCPU / 8GB each), managed PostgreSQL, managed Redis
- **Primary region**: +2 high-memory nodes (TigerBeetle), +block storage (Kafka)
- **Global**: CDN, WAF, GeoDNS, object storage (KYC docs + backups)
- **Compliance**: SOC 2 / PCI-DSS certified provider, data residency per region

---

## Monthly Cost Breakdown

### Option A: AWS (Hyperscaler)

| Component | Spec | Monthly Cost |
|-----------|------|-------------:|
| **EKS Clusters (×3)** | $0.10/hr per cluster | $219 |
| **EC2 Workers — Canada (3×m6i.xlarge)** | 4 vCPU, 16GB | $432 |
| **EC2 Workers — UK (3×m6i.xlarge)** | 4 vCPU, 16GB | $432 |
| **EC2 Workers — Africa (3×m6i.large)** | 2 vCPU, 8GB | $198 |
| **EC2 Financial (2×c6i.2xlarge)** | 8 vCPU, 16GB | $490 |
| **Aurora Global Database** | db.r6g.xlarge (primary + 2 replicas) | $1,200 |
| **ElastiCache Redis (×3)** | cache.r6g.large per region | $450 |
| **MSK Kafka (3 broker)** | kafka.m5.large | $480 |
| **CloudFront** | 1TB transfer + requests | $100 |
| **WAF** | Managed rules + custom | $50 |
| **Route53** | GeoDNS + health checks | $30 |
| **S3** | 500GB documents + backups | $15 |
| **NAT Gateway (×3)** | $0.045/hr + data | $300 |
| **Data transfer** | Inter-region + egress | $200 |
| **Shield Advanced** | DDoS protection | $3,000 |
| **Secrets Manager** | 50 secrets | $25 |
| | | |
| **Subtotal (with Shield)** | | **$7,621** |
| **Subtotal (without Shield)** | | **$4,621** |

### Option B: Vultr (Recommended Non-Hyperscaler)

| Component | Spec | Monthly Cost |
|-----------|------|-------------:|
| **VKE Clusters (×3)** | Free (pay only for nodes) | $0 |
| **Workers — Canada (3×vc2-4c-8gb)** | 4 vCPU, 8GB | $144 |
| **Workers — UK (3×vc2-4c-8gb)** | 4 vCPU, 8GB | $144 |
| **Workers — Africa (3×vc2-4c-8gb)** | 4 vCPU, 8GB | $144 |
| **Financial nodes (2×vc2-8c-32gb)** | 8 vCPU, 32GB | $192 |
| **Managed PostgreSQL (primary)** | 4 vCPU, 64GB storage, HA | $120 |
| **Managed PostgreSQL (2 replicas)** | 2 vCPU, 32GB each | $120 |
| **Managed Redis (×3)** | 1 vCPU, 2GB per region | $45 |
| **Block Storage (TigerBeetle 3×100GB)** | High-perf NVMe | $30 |
| **Block Storage (Kafka 3×200GB)** | High-perf NVMe | $60 |
| **Object Storage** | 500GB (documents + backups) | $5 |
| **Bandwidth** | 6TB included free | $0 |
| **Cloudflare Pro** | CDN + WAF + GeoDNS | $20 |
| **Cloudflare LB** | Load balancer + health checks | $5 |
| | | |
| **Subtotal** | | **$1,029** |

### Option C: DigitalOcean (Budget — No Africa)

| Component | Spec | Monthly Cost |
|-----------|------|-------------:|
| **DOKS Clusters (×2)** | Free control plane | $0 |
| **Workers — Canada (3×s-4vcpu-8gb)** | 4 vCPU, 8GB | $144 |
| **Workers — UK (3×s-4vcpu-8gb)** | 4 vCPU, 8GB | $144 |
| **Financial nodes (2×m-4vcpu-32gb)** | 4 vCPU, 32GB | $240 |
| **Managed PostgreSQL (primary)** | 4 vCPU, 8GB, HA | $120 |
| **Managed PostgreSQL (UK replica)** | 2 vCPU, 4GB | $60 |
| **Managed Redis (×2)** | 1 vCPU, 2GB per region | $30 |
| **Volumes (TigerBeetle + Kafka)** | 300GB total | $30 |
| **Spaces** | 500GB object storage | $5 |
| **Bandwidth** | 5TB included | $0 |
| **Cloudflare Pro** | CDN + WAF | $20 |
| | | |
| **Subtotal** | | **$793** |

⚠️ **Note**: No Africa DC. Add ~$500-1,000/mo for Lagos colocation (Rack Centre / MainOne) for NDPR compliance.

### Option D: Hybrid (Vultr + Rack Centre Lagos)

| Component | Spec | Monthly Cost |
|-----------|------|-------------:|
| **Vultr (CA + UK)** | 2 regions as above | $685 |
| **Rack Centre Lagos** | 2U colo + 2 servers + connectivity | $800 |
| **Cloudflare** | CDN + WAF + LB | $25 |
| | | |
| **Subtotal** | | **$1,510** |

---

## Comparison Summary

| Provider | Monthly Cost | Africa DC | Managed K8s | Managed PG | PCI-DSS | Bandwidth |
|----------|------------:|:---------:|:-----------:|:----------:|:-------:|:---------:|
| **AWS** | $4,621-7,621 | Cape Town | ✅ EKS | ✅ Aurora | ✅ | Expensive |
| **Vultr** | **$1,029** | **Johannesburg** | ✅ VKE | ✅ | ✅ | **6TB free** |
| **DigitalOcean** | $793 (+colo) | ❌ | ✅ DOKS | ✅ | ✅ | 5TB free |
| **Vultr + Lagos** | $1,510 | **Lagos** | ✅ | ✅ | ✅ | Free |
| **OVHcloud** | ~$1,200 | ❌ | ✅ | ✅ | ✅ | Unlimited |
| **Hetzner** | ~$500 | ❌ | ❌ | ❌ | ❌ | 20TB free |

---

## Annual Cost (Production)

| Provider | Year 1 | Year 2 | Year 3 | 3-Year Total |
|----------|-------:|-------:|-------:|-------------:|
| AWS (no Shield) | $55,452 | $55,452 | $55,452 | $166,356 |
| AWS (with Shield) | $91,452 | $91,452 | $91,452 | $274,356 |
| **Vultr** | **$12,348** | **$12,348** | **$15,000** | **$39,696** |
| DigitalOcean + colo | $18,516 | $18,516 | $18,516 | $55,548 |
| Vultr + Lagos | $18,120 | $18,120 | $18,120 | $54,360 |

**Vultr saves $127K-235K over 3 years vs AWS** while providing equivalent compliance certifications.

---

## Scaling Costs (10× Traffic)

When scaling from 5K → 50K monthly transactions:

| Provider | Base → Scaled | Cost Increase |
|----------|:------------:|:-------------:|
| AWS | $4,621 → $12,000 | 2.6× |
| Vultr | $1,029 → $2,500 | 2.4× |
| DigitalOcean | $793 → $2,000 | 2.5× |

Vultr's free bandwidth is the key differentiator — AWS egress charges ($0.09/GB) compound at scale.

---

## Decision Matrix

| Factor | Weight | AWS | Vultr | DigitalOcean |
|--------|--------|:---:|:-----:|:------------:|
| Cost | 25% | 2/10 | 9/10 | 10/10 |
| Africa presence | 20% | 8/10 | 8/10 | 2/10 |
| Managed services | 20% | 10/10 | 8/10 | 7/10 |
| Compliance certs | 15% | 10/10 | 8/10 | 7/10 |
| Bandwidth | 10% | 3/10 | 10/10 | 8/10 |
| Enterprise support | 10% | 10/10 | 6/10 | 5/10 |
| **Weighted Score** | | **6.7** | **8.5** | **6.4** |

**Recommendation: Vultr** for best balance of cost, Africa coverage, and managed services.
Use **Vultr + Rack Centre Lagos** if legal counsel requires in-country Nigerian hosting.
