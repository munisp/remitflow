#!/bin/bash
set -e

# Required secrets for the generated charts' `secrets:` blocks. Source them from
# infrastructure/.env (see infrastructure/.env.example) before running this script.
for var in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME REDIS_HOST REDIS_PORT REDIS_PASSWORD REDIS_DB; do
  if [ -z "${!var}" ]; then
    echo "Missing required env var: $var (see infrastructure/.env.example)" >&2
    exit 1
  fi
done

# Script to generate Helm chart files for POS services
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$SCRIPT_DIR/charts"
TEMPLATE_CHART="network-operations"

# Array of POS services
SERVICES=("pos-management" "pos-integration" "pos-hardware-management" "pos-terminal-management")

# Array of route prefixes for each service
declare -A ROUTE_PREFIXES
ROUTE_PREFIXES["pos-management"]="pos-management"
ROUTE_PREFIXES["pos-integration"]="pos-integration"
ROUTE_PREFIXES["pos-hardware-management"]="pos-hardware"
ROUTE_PREFIXES["pos-terminal-management"]="pos-terminals"

# Array of image tags for each service
declare -A IMAGE_TAGS
IMAGE_TAGS["pos-management"]="0.0.1"
IMAGE_TAGS["pos-integration"]="0.0.1"
IMAGE_TAGS["pos-hardware-management"]="0.0.1"
IMAGE_TAGS["pos-terminal-management"]="0.0.1"

# Create .helmignore for all services
for SERVICE in "${SERVICES[@]}"; do
  cat > "$BASE_DIR/$SERVICE/.helmignore" <<'EOF'
# Patterns to ignore when building packages.
*.swp
*.bak
*.tmp
*.orig
*~
.DS_Store
EOF
done

# Create values.yaml for all services
for SERVICE in "${SERVICES[@]}"; do
  SERVICE_UPPER=$(echo "$SERVICE" | tr '-' '_' | tr '[:lower:]' '[:upper:]')
  cat > "$BASE_DIR/$SERVICE/values.yaml" <<EOF
replicaCount: 1

image:
  repository: registry.digitalocean.com/talentgraph-auth/54remit-$SERVICE
  pullPolicy: IfNotPresent
  tag: ${IMAGE_TAGS[$SERVICE]}

nameOverride: ""
fullnameOverride: ""

serviceAccount:
  create: false
  name: 54remit

podAnnotations: {}
podLabels: {}
podSecurityContext: {}
securityContext: {}

service:
  type: ClusterIP
  port: 80
  targetPort: 8080

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 250m
    memory: 500Mi

autoscaling:
  enabled: false
  minReplicas: 1
  maxReplicas: 5
  targetCPUUtilizationPercentage: 80

volumes: []
volumeMounts: []

nodeSelector: {}
tolerations: []
affinity: {}

dapr:
  appId: $SERVICE
  appPort: 8080
  enableMetrics: true
  enabled: true
  metricsPort: 9099
  sidecarListenAddresses: "0.0.0.0"
  cpu-request: 100m
  cpu-limit: 300m
  memory-request: 250Mi
  memory-limit: 1000Mi

secrets:
  DATABASE_URL: postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME?sslmode=require
  DB_HOST: $DB_HOST
  DB_PORT: "$DB_PORT"
  DB_NAME: $DB_NAME
  DB_USER: $DB_USER
  DB_PASSWORD: $DB_PASSWORD
  REDIS_HOST: $REDIS_HOST
  REDIS_PORT: "$REDIS_PORT"
  REDIS_PASSWORD: $REDIS_PASSWORD
  REDIS_ADDR: $REDIS_HOST:$REDIS_PORT
  REDIS_DB: "$REDIS_DB"
  PORT: "8080"
EOF
done

echo "Helm chart files generated successfully for all POS services!"
