environment = "production"
domain      = "remitflow.app"

# Vultr API key — set via TF_VAR_vultr_api_key or Vault
# vultr_api_key = ""

# Cloudflare — set via TF_VAR_cloudflare_api_token
# cloudflare_api_token = ""
# cloudflare_zone_id   = ""

regions = {
  canada = {
    id         = "yto"         # Toronto
    label      = "Canada (Toronto)"
    node_count = 3
    node_plan  = "vc2-4c-8gb"  # 4 vCPU, 8GB RAM — $48/mo each
    primary    = true
  }
  uk = {
    id         = "lhr"         # London
    label      = "UK (London)"
    node_count = 3
    node_plan  = "vc2-4c-8gb"
    primary    = false
  }
  africa = {
    id         = "jnb"         # Johannesburg
    label      = "Africa (Johannesburg)"
    node_count = 3
    node_plan  = "vc2-4c-8gb"
    primary    = false
  }
}

# Managed PostgreSQL
db_plan         = "vultr-dbaas-startup-cc-hp-amd-4-64-2"   # 4 vCPU, 64GB, 2 standby — $120/mo
db_plan_replica = "vultr-dbaas-startup-cc-hp-amd-2-32-1"   # 2 vCPU, 32GB, 1 standby — $60/mo
