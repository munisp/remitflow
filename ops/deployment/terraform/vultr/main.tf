# RemitFlow — Vultr Multi-Region Production Infrastructure
#
# Deploys:
#   - 3 Kubernetes clusters (Toronto, London, Johannesburg)
#   - Managed PostgreSQL (primary + read replicas)
#   - Managed Redis per region
#   - Block storage for TigerBeetle + Kafka
#   - Cloudflare CDN + WAF + GeoDNS
#   - Object storage for KYC documents & backups
#
# Usage:
#   cd ops/deployment/terraform/vultr
#   terraform init
#   terraform plan -var-file=production.tfvars
#   terraform apply -var-file=production.tfvars
#
# Cost estimate: ~$1,500-3,000/month (vs $3,000-8,000 on AWS)

terraform {
  required_version = ">= 1.6"
  required_providers {
    vultr = {
      source  = "vultr/vultr"
      version = "~> 2.19"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.25"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }

  backend "s3" {
    # Vultr Object Storage is S3-compatible
    endpoint                    = "https://yto1.vultrobjects.com"
    bucket                      = "remitflow-terraform-state"
    key                         = "production/terraform.tfstate"
    region                      = "us-east-1" # Required by S3 backend but ignored by Vultr
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    force_path_style            = true
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "vultr_api_key" {
  type      = string
  sensitive = true
}

variable "cloudflare_api_token" {
  type      = string
  sensitive = true
}

variable "cloudflare_zone_id" {
  type = string
}

variable "environment" {
  type    = string
  default = "production"
}

variable "domain" {
  type    = string
  default = "remitflow.app"
}

variable "regions" {
  type = map(object({
    id         = string  # Vultr region ID
    label      = string
    node_count = number
    node_plan  = string
    primary    = bool
  }))
  default = {
    canada = {
      id         = "yto"    # Toronto
      label      = "Canada (Toronto)"
      node_count = 3
      node_plan  = "vc2-4c-8gb"  # 4 vCPU, 8GB RAM
      primary    = true
    }
    uk = {
      id         = "lhr"    # London
      label      = "UK (London)"
      node_count = 3
      node_plan  = "vc2-4c-8gb"
      primary    = false
    }
    africa = {
      id         = "jnb"    # Johannesburg
      label      = "Africa (Johannesburg)"
      node_count = 3
      node_plan  = "vc2-4c-8gb"
      primary    = false
    }
  }
}

variable "db_plan" {
  type    = string
  default = "vultr-dbaas-startup-cc-hp-amd-4-64-2"  # 4 vCPU, 64GB storage, 2 standby
}

variable "db_plan_replica" {
  type    = string
  default = "vultr-dbaas-startup-cc-hp-amd-2-32-1"  # 2 vCPU, 32GB, 1 standby
}

# ── Provider Configuration ─────────────────────────────────────────────────────

provider "vultr" {
  api_key = var.vultr_api_key
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ── Kubernetes Clusters ────────────────────────────────────────────────────────

resource "vultr_kubernetes" "cluster" {
  for_each = var.regions

  region  = each.value.id
  label   = "remitflow-${var.environment}-${each.key}"
  version = "v1.29.2+1"

  node_pools {
    node_quantity = each.value.node_count
    plan          = each.value.node_plan
    label         = "general"
    auto_scaler   = true
    min_nodes     = each.value.node_count
    max_nodes     = each.value.node_count * 3
  }
}

# Financial workload node pool (dedicated for TigerBeetle, ledger ops)
resource "vultr_kubernetes_node_pools" "financial" {
  for_each = { for k, v in var.regions : k => v if v.primary }

  cluster_id    = vultr_kubernetes.cluster[each.key].id
  node_quantity = 2
  plan          = "vc2-8c-32gb"  # High-memory for TigerBeetle
  label         = "financial"
  auto_scaler   = true
  min_nodes     = 2
  max_nodes     = 4
}

# ── Managed PostgreSQL ─────────────────────────────────────────────────────────

resource "vultr_database" "primary" {
  region                  = var.regions["canada"].id
  label                   = "remitflow-${var.environment}-primary"
  database_engine         = "pg"
  database_engine_version = "16"
  plan                    = var.db_plan
  cluster_time_zone       = "America/Toronto"

  maintenance_dow  = "sunday"
  maintenance_time = "03:00"
}

resource "vultr_database" "replica_uk" {
  region                  = var.regions["uk"].id
  label                   = "remitflow-${var.environment}-uk-replica"
  database_engine         = "pg"
  database_engine_version = "16"
  plan                    = var.db_plan_replica
  cluster_time_zone       = "Europe/London"

  maintenance_dow  = "sunday"
  maintenance_time = "03:00"
}

resource "vultr_database" "replica_africa" {
  region                  = var.regions["africa"].id
  label                   = "remitflow-${var.environment}-africa-replica"
  database_engine         = "pg"
  database_engine_version = "16"
  plan                    = var.db_plan_replica
  cluster_time_zone       = "Africa/Lagos"

  maintenance_dow  = "sunday"
  maintenance_time = "03:00"
}

# ── Managed Redis (per region for session/cache) ──────────────────────────────

resource "vultr_database" "redis_canada" {
  region                  = var.regions["canada"].id
  label                   = "remitflow-${var.environment}-redis-ca"
  database_engine         = "redis"
  database_engine_version = "7"
  plan                    = "vultr-dbaas-startup-cc-1-55-2"

  redis_eviction_policy = "volatile-lru"
}

resource "vultr_database" "redis_uk" {
  region                  = var.regions["uk"].id
  label                   = "remitflow-${var.environment}-redis-uk"
  database_engine         = "redis"
  database_engine_version = "7"
  plan                    = "vultr-dbaas-startup-cc-1-55-2"

  redis_eviction_policy = "volatile-lru"
}

resource "vultr_database" "redis_africa" {
  region                  = var.regions["africa"].id
  label                   = "remitflow-${var.environment}-redis-af"
  database_engine         = "redis"
  database_engine_version = "7"
  plan                    = "vultr-dbaas-startup-cc-1-55-2"

  redis_eviction_policy = "volatile-lru"
}

# ── Block Storage (TigerBeetle + Kafka persistent volumes) ────────────────────

resource "vultr_block_storage" "tigerbeetle" {
  for_each = var.regions

  region      = each.value.id
  label       = "remitflow-tigerbeetle-${each.key}"
  size_gb     = 100  # TigerBeetle data
  block_type  = "high_perf"
}

resource "vultr_block_storage" "kafka" {
  for_each = var.regions

  region      = each.value.id
  label       = "remitflow-kafka-${each.key}"
  size_gb     = 200  # Kafka log retention
  block_type  = "high_perf"
}

# ── Object Storage (KYC documents, backups, audit exports) ────────────────────

resource "vultr_object_storage" "documents" {
  cluster_id = 5  # Toronto (yto1)
  label      = "remitflow-${var.environment}-documents"
}

resource "vultr_object_storage" "backups" {
  cluster_id = 5  # Toronto (yto1)
  label      = "remitflow-${var.environment}-backups"
}

# ── Firewall Rules ────────────────────────────────────────────────────────────

resource "vultr_firewall_group" "k8s" {
  description = "RemitFlow K8s cluster firewall"
}

resource "vultr_firewall_rule" "allow_https" {
  firewall_group_id = vultr_firewall_group.k8s.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "443"
  notes             = "Allow HTTPS from anywhere"
}

resource "vultr_firewall_rule" "allow_http" {
  firewall_group_id = vultr_firewall_group.k8s.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "80"
  notes             = "Allow HTTP (redirect to HTTPS)"
}

resource "vultr_firewall_rule" "deny_all" {
  firewall_group_id = vultr_firewall_group.k8s.id
  protocol          = "tcp"
  ip_type           = "v4"
  subnet            = "0.0.0.0"
  subnet_size       = 0
  port              = "1:65535"
  notes             = "Deny all other TCP (overridden by specific allows above)"
}

# ── Cloudflare CDN + WAF + GeoDNS ─────────────────────────────────────────────

resource "cloudflare_record" "api_canada" {
  zone_id = var.cloudflare_zone_id
  name    = "api"
  type    = "A"
  content = vultr_kubernetes.cluster["canada"].ip
  proxied = true
}

resource "cloudflare_record" "api_uk" {
  zone_id = var.cloudflare_zone_id
  name    = "api-eu"
  type    = "A"
  content = vultr_kubernetes.cluster["uk"].ip
  proxied = true
}

resource "cloudflare_record" "api_africa" {
  zone_id = var.cloudflare_zone_id
  name    = "api-af"
  type    = "A"
  content = vultr_kubernetes.cluster["africa"].ip
  proxied = true
}

# Cloudflare Load Balancer with GeoDNS
resource "cloudflare_load_balancer" "api" {
  zone_id          = var.cloudflare_zone_id
  name             = "api.${var.domain}"
  fallback_pool_id = cloudflare_load_balancer_pool.canada.id
  default_pool_ids = [cloudflare_load_balancer_pool.canada.id]
  proxied          = true

  # GeoDNS routing
  region_pools {
    region   = "WNAM"  # Western North America
    pool_ids = [cloudflare_load_balancer_pool.canada.id]
  }
  region_pools {
    region   = "ENAM"  # Eastern North America
    pool_ids = [cloudflare_load_balancer_pool.canada.id]
  }
  region_pools {
    region   = "WEU"   # Western Europe
    pool_ids = [cloudflare_load_balancer_pool.uk.id]
  }
  region_pools {
    region   = "EEU"   # Eastern Europe
    pool_ids = [cloudflare_load_balancer_pool.uk.id]
  }
  region_pools {
    region   = "SAF"   # Southern Africa
    pool_ids = [cloudflare_load_balancer_pool.africa.id]
  }
  region_pools {
    region   = "WAF"   # Western Africa
    pool_ids = [cloudflare_load_balancer_pool.africa.id]
  }
  region_pools {
    region   = "NAF"   # Northern Africa
    pool_ids = [cloudflare_load_balancer_pool.africa.id]
  }
}

resource "cloudflare_load_balancer_pool" "canada" {
  name = "remitflow-canada"

  origins {
    name    = "vke-canada"
    address = vultr_kubernetes.cluster["canada"].ip
    enabled = true
  }

  monitor = cloudflare_load_balancer_monitor.health.id
}

resource "cloudflare_load_balancer_pool" "uk" {
  name = "remitflow-uk"

  origins {
    name    = "vke-uk"
    address = vultr_kubernetes.cluster["uk"].ip
    enabled = true
  }

  monitor = cloudflare_load_balancer_monitor.health.id
}

resource "cloudflare_load_balancer_pool" "africa" {
  name = "remitflow-africa"

  origins {
    name    = "vke-africa"
    address = vultr_kubernetes.cluster["africa"].ip
    enabled = true
  }

  monitor = cloudflare_load_balancer_monitor.health.id
}

resource "cloudflare_load_balancer_monitor" "health" {
  type           = "https"
  expected_codes = "200"
  path           = "/api/health"
  interval       = 60
  retries        = 2
  timeout        = 5
  method         = "GET"
}

# ── Cloudflare WAF Rules ──────────────────────────────────────────────────────

resource "cloudflare_ruleset" "waf" {
  zone_id = var.cloudflare_zone_id
  name    = "RemitFlow WAF"
  kind    = "zone"
  phase   = "http_request_firewall_custom"

  # Rate limiting: 100 requests per minute per IP
  rules {
    action      = "block"
    expression  = "(http.request.uri.path contains \"/api/\" and rate_limit.requests_per_period > 100)"
    description = "Rate limit API requests"
    enabled     = true
  }

  # Block known bad user agents
  rules {
    action      = "block"
    expression  = "(http.user_agent contains \"sqlmap\" or http.user_agent contains \"nikto\" or http.user_agent contains \"nmap\")"
    description = "Block security scanning tools"
    enabled     = true
  }

  # Challenge suspicious patterns
  rules {
    action      = "managed_challenge"
    expression  = "(http.request.uri.path contains \"admin\" and not ip.src in {10.0.0.0/8})"
    description = "Challenge admin access from non-internal IPs"
    enabled     = true
  }
}

# Managed WAF rulesets (OWASP Core Rule Set)
resource "cloudflare_ruleset" "managed_waf" {
  zone_id = var.cloudflare_zone_id
  name    = "RemitFlow Managed WAF"
  kind    = "zone"
  phase   = "http_request_firewall_managed"

  rules {
    action = "execute"
    action_parameters {
      id = "efb7b8c949ac4650a09736fc376e9aee"  # Cloudflare Managed Ruleset
    }
    expression  = "true"
    description = "Cloudflare Managed Rules"
    enabled     = true
  }

  rules {
    action = "execute"
    action_parameters {
      id = "4814384a9e5d4991b9815dcfc25d2f1f"  # OWASP Core Rule Set
    }
    expression  = "true"
    description = "OWASP Core Rule Set"
    enabled     = true
  }
}

# ── SSL/TLS Configuration ─────────────────────────────────────────────────────

resource "cloudflare_zone_settings_override" "ssl" {
  zone_id = var.cloudflare_zone_id

  settings {
    ssl                      = "strict"
    min_tls_version          = "1.2"
    tls_1_3                  = "on"
    automatic_https_rewrites = "on"
    always_use_https         = "on"
    security_header {
      enabled            = true
      max_age            = 31536000
      include_subdomains = true
      preload            = true
      nosniff            = true
    }
  }
}

# ── Outputs ────────────────────────────────────────────────────────────────────

output "k8s_clusters" {
  value = { for k, v in vultr_kubernetes.cluster : k => {
    id       = v.id
    ip       = v.ip
    endpoint = v.endpoint
    region   = v.region
  }}
}

output "databases" {
  value = {
    primary = {
      host = vultr_database.primary.host
      port = vultr_database.primary.port
    }
    uk_replica = {
      host = vultr_database.replica_uk.host
      port = vultr_database.replica_uk.port
    }
    africa_replica = {
      host = vultr_database.replica_africa.host
      port = vultr_database.replica_africa.port
    }
  }
  sensitive = true
}

output "redis" {
  value = {
    canada = vultr_database.redis_canada.host
    uk     = vultr_database.redis_uk.host
    africa = vultr_database.redis_africa.host
  }
  sensitive = true
}

output "object_storage" {
  value = {
    documents = vultr_object_storage.documents.s3_hostname
    backups   = vultr_object_storage.backups.s3_hostname
  }
}
