# RemitFlow — DigitalOcean Multi-Region Infrastructure
#
# Deploys:
#   - 2 DOKS clusters (Toronto, London) — no Africa DC available
#   - Managed PostgreSQL (primary + standby)
#   - Managed Redis per region
#   - Spaces (S3-compatible object storage)
#   - Cloudflare for CDN + WAF + GeoDNS (including Africa routing)
#
# NOTE: DigitalOcean has NO African data centers.
#       For Nigerian data residency (NDPR), you need a separate colo provider
#       in Lagos (Rack Centre, MainOne). This terraform covers CA + UK only.
#       See docs/deployment-guide.md for the hybrid approach.
#
# Usage:
#   cd ops/deployment/terraform/digitalocean
#   terraform init
#   terraform plan -var-file=production.tfvars
#   terraform apply -var-file=production.tfvars
#
# Cost estimate: ~$800-1,500/month (Canada + UK regions only)

terraform {
  required_version = ">= 1.6"
  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.36"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.25"
    }
  }

  backend "s3" {
    endpoint                    = "https://tor1.digitaloceanspaces.com"
    bucket                      = "remitflow-terraform-state"
    key                         = "production/terraform.tfstate"
    region                      = "us-east-1"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_requesting_account_id  = true
    force_path_style            = true
  }
}

# ── Variables ──────────────────────────────────────────────────────────────────

variable "do_token" {
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

# ── Provider Configuration ─────────────────────────────────────────────────────

provider "digitalocean" {
  token = var.do_token
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# ── Kubernetes Clusters ────────────────────────────────────────────────────────

resource "digitalocean_kubernetes_cluster" "canada" {
  name    = "remitflow-${var.environment}-ca"
  region  = "tor1"  # Toronto
  version = "1.29.1-do.0"

  node_pool {
    name       = "general"
    size       = "s-4vcpu-8gb"  # $48/mo each
    node_count = 3
    auto_scale = true
    min_nodes  = 3
    max_nodes  = 10

    labels = {
      role = "general"
    }
  }
}

resource "digitalocean_kubernetes_node_pool" "canada_financial" {
  cluster_id = digitalocean_kubernetes_cluster.canada.id
  name       = "financial"
  size       = "m-4vcpu-32gb"  # High memory for TigerBeetle
  node_count = 2
  auto_scale = true
  min_nodes  = 2
  max_nodes  = 4

  labels = {
    role = "financial"
  }

  taint {
    key    = "workload"
    value  = "financial"
    effect = "NoSchedule"
  }
}

resource "digitalocean_kubernetes_cluster" "uk" {
  name    = "remitflow-${var.environment}-uk"
  region  = "lon1"  # London
  version = "1.29.1-do.0"

  node_pool {
    name       = "general"
    size       = "s-4vcpu-8gb"
    node_count = 3
    auto_scale = true
    min_nodes  = 3
    max_nodes  = 10

    labels = {
      role = "general"
    }
  }
}

# ── Managed PostgreSQL ─────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "primary" {
  name       = "remitflow-${var.environment}-primary"
  engine     = "pg"
  version    = "16"
  size       = "db-s-4vcpu-8gb"  # $120/mo
  region     = "tor1"
  node_count = 2  # Primary + standby

  maintenance_window {
    day  = "sunday"
    hour = "03:00:00"
  }
}

resource "digitalocean_database_cluster" "uk_replica" {
  name       = "remitflow-${var.environment}-uk"
  engine     = "pg"
  version    = "16"
  size       = "db-s-2vcpu-4gb"  # $60/mo
  region     = "lon1"
  node_count = 1
}

resource "digitalocean_database_firewall" "primary" {
  cluster_id = digitalocean_database_cluster.primary.id

  rule {
    type  = "k8s"
    value = digitalocean_kubernetes_cluster.canada.id
  }
  rule {
    type  = "k8s"
    value = digitalocean_kubernetes_cluster.uk.id
  }
}

resource "digitalocean_database_db" "remitflow" {
  cluster_id = digitalocean_database_cluster.primary.id
  name       = "remitflow"
}

resource "digitalocean_database_user" "app" {
  cluster_id = digitalocean_database_cluster.primary.id
  name       = "remitflow_app"
}

# ── Managed Redis ─────────────────────────────────────────────────────────────

resource "digitalocean_database_cluster" "redis_ca" {
  name       = "remitflow-${var.environment}-redis-ca"
  engine     = "redis"
  version    = "7"
  size       = "db-s-1vcpu-2gb"  # $15/mo
  region     = "tor1"
  node_count = 1

  eviction_policy = "volatile_lru"
}

resource "digitalocean_database_cluster" "redis_uk" {
  name       = "remitflow-${var.environment}-redis-uk"
  engine     = "redis"
  version    = "7"
  size       = "db-s-1vcpu-2gb"
  region     = "lon1"
  node_count = 1

  eviction_policy = "volatile_lru"
}

# ── Spaces (Object Storage) ───────────────────────────────────────────────────

resource "digitalocean_spaces_bucket" "documents" {
  name   = "remitflow-${var.environment}-documents"
  region = "tor1"
  acl    = "private"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    enabled = true
    expiration {
      days = 2555  # 7 years (regulatory retention)
    }
  }
}

resource "digitalocean_spaces_bucket" "backups" {
  name   = "remitflow-${var.environment}-backups"
  region = "tor1"
  acl    = "private"

  lifecycle_rule {
    enabled = true
    expiration {
      days = 90
    }
  }
}

# ── Volumes (Block Storage for TigerBeetle + Kafka) ───────────────────────────

resource "digitalocean_volume" "tigerbeetle_ca" {
  region                  = "tor1"
  name                    = "remitflow-tigerbeetle-ca"
  size                    = 100
  description             = "TigerBeetle data volume (Canada)"
  initial_filesystem_type = "xfs"
}

resource "digitalocean_volume" "kafka_ca" {
  region                  = "tor1"
  name                    = "remitflow-kafka-ca"
  size                    = 200
  description             = "Kafka log volume (Canada)"
  initial_filesystem_type = "xfs"
}

# ── Outputs ────────────────────────────────────────────────────────────────────

output "k8s_clusters" {
  value = {
    canada = {
      id       = digitalocean_kubernetes_cluster.canada.id
      endpoint = digitalocean_kubernetes_cluster.canada.endpoint
    }
    uk = {
      id       = digitalocean_kubernetes_cluster.uk.id
      endpoint = digitalocean_kubernetes_cluster.uk.endpoint
    }
  }
}

output "database" {
  value = {
    host     = digitalocean_database_cluster.primary.host
    port     = digitalocean_database_cluster.primary.port
    database = "remitflow"
  }
  sensitive = true
}

output "redis" {
  value = {
    canada = digitalocean_database_cluster.redis_ca.host
    uk     = digitalocean_database_cluster.redis_uk.host
  }
  sensitive = true
}
