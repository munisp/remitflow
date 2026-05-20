# HashiCorp Vault Configuration for Nigerian Remittance Platform
# Secrets management for payment corridors, API keys, and sensitive configuration

# Storage backend - use Consul in production
storage "consul" {
  address = "consul:8500"
  path    = "vault/"
  scheme  = "http"
}

# Listener configuration
listener "tcp" {
  address         = "0.0.0.0:8200"
  tls_disable     = false
  tls_cert_file   = "/vault/certs/vault.crt"
  tls_key_file    = "/vault/certs/vault.key"
}

# API address
api_addr = "https://vault:8200"
cluster_addr = "https://vault:8201"

# UI enabled for admin access
ui = true

# Telemetry for monitoring
telemetry {
  prometheus_retention_time = "30s"
  disable_hostname          = true
}

# Audit logging
audit {
  type = "file"
  options {
    file_path = "/vault/logs/audit.log"
  }
}

# Auto-unseal using AWS KMS (production)
# seal "awskms" {
#   region     = "eu-west-1"
#   kms_key_id = "alias/vault-unseal-key"
# }

# Development mode - disable in production
# disable_mlock = true
