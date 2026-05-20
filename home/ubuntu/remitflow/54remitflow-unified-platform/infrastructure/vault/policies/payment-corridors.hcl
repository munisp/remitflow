# Vault Policy for Payment Corridor Services
# Grants access to corridor-specific secrets

# Mojaloop corridor secrets
path "secret/data/corridors/mojaloop/*" {
  capabilities = ["read", "list"]
}

path "secret/data/corridors/mojaloop/api-keys" {
  capabilities = ["read"]
}

path "secret/data/corridors/mojaloop/certificates" {
  capabilities = ["read"]
}

# PAPSS corridor secrets
path "secret/data/corridors/papss/*" {
  capabilities = ["read", "list"]
}

path "secret/data/corridors/papss/api-keys" {
  capabilities = ["read"]
}

path "secret/data/corridors/papss/settlement-keys" {
  capabilities = ["read"]
}

# UPI corridor secrets
path "secret/data/corridors/upi/*" {
  capabilities = ["read", "list"]
}

path "secret/data/corridors/upi/npci-credentials" {
  capabilities = ["read"]
}

# PIX corridor secrets
path "secret/data/corridors/pix/*" {
  capabilities = ["read", "list"]
}

path "secret/data/corridors/pix/bcb-certificates" {
  capabilities = ["read"]
}

# NIBSS corridor secrets
path "secret/data/corridors/nibss/*" {
  capabilities = ["read", "list"]
}

path "secret/data/corridors/nibss/bvn-api-key" {
  capabilities = ["read"]
}

# Deny access to other corridors' admin secrets
path "secret/data/corridors/*/admin" {
  capabilities = ["deny"]
}
