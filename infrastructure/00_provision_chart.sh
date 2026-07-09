#!/bin/bash
set -e

# Required secrets for the generated chart's `secrets:` block. Source them from
# infrastructure/.env (see infrastructure/.env.example) before running this script.
for var in DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME; do
  if [ -z "${!var}" ]; then
    echo "Missing required env var: $var (see infrastructure/.env.example)" >&2
    exit 1
  fi
done

# Prompt user for chart name and version
read -p "Enter new chart name: " CHART_NAME
read -p "Enter new chart description: " CHART_DESC
read -p "Enter chart version (e.g., 0.1.0): " CHART_VERSION

TEMPLATE_DIR="./templates/template-chart"
NEW_CHART_DIR="./charts/$CHART_NAME"

# Check if template exists
if [ ! -d "$TEMPLATE_DIR" ]; then
    echo "Template chart directory $TEMPLATE_DIR does not exist."
    exit 1
fi

# Check if new chart already exists
if [ -d "$NEW_CHART_DIR" ]; then
    echo "Directory $NEW_CHART_DIR already exists. Exiting."
    exit 1
fi

# Copy template chart
cp -r "$TEMPLATE_DIR" "$NEW_CHART_DIR"

# Recursively replace 'template-chart' with new chart name
grep -rl "template-chart" "$NEW_CHART_DIR" | xargs perl -pi -e "s/template-chart/$CHART_NAME/g"

# Overwrite Chart.yaml with inline content
cat > "$NEW_CHART_DIR/Chart.yaml" <<EOL
apiVersion: v2
name: $CHART_NAME
description: $CHART_DESC
type: application
version: $CHART_VERSION
appVersion: "1.0.0"
EOL

# Overwrite values.yaml with inline content
cat > "$NEW_CHART_DIR/values.yaml" <<EOL
replicaCount: 1
image:
  repository: registry.digitalocean.com/talentgraph-auth/54remit-$CHART_NAME
  pullPolicy: IfNotPresent
  tag: $CHART_VERSION
nameOverride: ''
fullnameOverride: ''
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
  targetPort: 80
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
  maxReplicas: 100
  targetCPUUtilizationPercentage: 80
volumes: []
volumeMounts: []
nodeSelector: {}
tolerations: []
affinity: {}
dapr:
  appId: $CHART_NAME
  appPort: 80
  enableMetrics: true
  enabled: true
  metricsPort: 9099
  sidecarListenAddresses: "0.0.0.0"
  cpu-request: 100m
  cpu-limit: 300m
  memory-request: 250Mi
  memory-limit: 1000Mi
secrets:
  DB_HOST: $DB_HOST
  DB_PORT: $DB_PORT
  DB_USER: $DB_USER
  DB_PASSWORD: $DB_PASSWORD
  DB_NAME: $DB_NAME
  DATABASE_URI: postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME
  DAPR_PUBSUB_NAME: pubsub
EOL

echo "Chart $CHART_NAME created successfully at $NEW_CHART_DIR"
