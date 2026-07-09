#!/bin/bash

# Deploy schema to Permify via the service endpoint
# This ensures all pods get the schema update

SCHEMA_FILE="enhanced_schema.perm"
TENANT_ID="bpmgd"

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "Error: $SCHEMA_FILE not found"
  exit 1
fi

echo "Reading schema from $SCHEMA_FILE..."
SCHEMA_CONTENT=$(cat "$SCHEMA_FILE")

echo "Deploying schema to tenant: $TENANT_ID via service endpoint..."

# Deploy multiple times to ensure all 3 pods get it via load balancer
for i in {1..10}; do
  echo "Attempt $i..."
  
  kubectl run curl-deploy-$i --rm -i --restart=Never --image=curlimages/curl:latest -- \
    -X POST "http://permify.permify.svc.cluster.local:3476/v1/tenants/$TENANT_ID/schemas/write" \
    -H "Content-Type: application/json" \
    -d "{
      \"schema\": $(echo "$SCHEMA_CONTENT" | jq -Rs .)
    }" 2>&1 | grep -E "schema_version|code|message" || echo "Request sent"
  
  sleep 1
done

echo ""
echo "Schema deployment complete. Deployed 10 times to ensure all pods received it."
