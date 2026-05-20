# Vault Policy for Backend Services
# Grants access to database credentials, API keys, and service secrets

# Database credentials
path "secret/data/database/postgres" {
  capabilities = ["read"]
}

path "secret/data/database/redis" {
  capabilities = ["read"]
}

path "secret/data/database/tigerbeetle" {
  capabilities = ["read"]
}

# Kafka credentials
path "secret/data/messaging/kafka" {
  capabilities = ["read"]
}

# Service-to-service authentication
path "secret/data/services/jwt-signing-key" {
  capabilities = ["read"]
}

path "secret/data/services/api-gateway-key" {
  capabilities = ["read"]
}

# External API keys
path "secret/data/external/sms-provider" {
  capabilities = ["read"]
}

path "secret/data/external/email-provider" {
  capabilities = ["read"]
}

path "secret/data/external/kyc-provider" {
  capabilities = ["read"]
}

# Encryption keys
path "secret/data/encryption/data-at-rest" {
  capabilities = ["read"]
}

path "secret/data/encryption/pii-encryption" {
  capabilities = ["read"]
}

# Transit engine for encryption operations
path "transit/encrypt/remittance-data" {
  capabilities = ["update"]
}

path "transit/decrypt/remittance-data" {
  capabilities = ["update"]
}

# PKI for service certificates
path "pki/issue/remittance-services" {
  capabilities = ["create", "update"]
}
