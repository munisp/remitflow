# Vault Admin Policy
# Full access for platform administrators

# Full access to all secrets
path "secret/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Manage auth methods
path "auth/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

# Manage policies
path "sys/policies/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# Manage mounts
path "sys/mounts/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# View audit logs
path "sys/audit/*" {
  capabilities = ["read", "list", "sudo"]
}

# Manage tokens
path "auth/token/*" {
  capabilities = ["create", "read", "update", "delete", "list", "sudo"]
}

# Health check
path "sys/health" {
  capabilities = ["read", "sudo"]
}

# Seal/unseal operations
path "sys/seal" {
  capabilities = ["update", "sudo"]
}

path "sys/unseal" {
  capabilities = ["update", "sudo"]
}

# Key rotation
path "sys/rotate" {
  capabilities = ["update", "sudo"]
}

# Transit engine management
path "transit/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}

# PKI management
path "pki/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
