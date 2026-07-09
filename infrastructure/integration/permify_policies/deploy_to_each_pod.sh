#!/bin/bash

SCHEMA_FILE="enhanced_schema.perm"
TENANT_ID="bpmgd"

if [ ! -f "$SCHEMA_FILE" ]; then
  echo "Error: $SCHEMA_FILE not found"
  exit 1
fi

echo "Reading schema from $SCHEMA_FILE..."
SCHEMA_CONTENT=$(cat "$SCHEMA_FILE")

# Get all Permify pods
PODS=($(kubectl get pods -n permify -o name | grep permify | sed 's|pod/||'))

echo "Found ${#PODS[@]} Permify pods: ${PODS[@]}"
echo ""

for POD in "${PODS[@]}"; do
  echo "=========================================="
  echo "Deploying schema to pod: $POD"
  echo "=========================================="
  
  # Start port-forward in background
  kubectl port-forward -n permify "$POD" 3477:3476 >/dev/null 2>&1 &
  PF_PID=$!
  
  # Wait for port-forward to be ready
  sleep 2
  
  # Deploy schema to this specific pod
  echo "Sending schema deployment request..."
  RESPONSE=$(curl -s -X POST "http://localhost:3477/v1/tenants/$TENANT_ID/schemas/write" \
    -H "Content-Type: application/json" \
    -d "{\"schema\": $(echo "$SCHEMA_CONTENT" | jq -Rs .)}")
  
  echo "Response: $RESPONSE"
  
  # Extract schema version
  SCHEMA_VERSION=$(echo "$RESPONSE" | jq -r '.schema_version // "FAILED"')
  echo "Schema version: $SCHEMA_VERSION"
  
  # Verify schema was deployed
  echo "Verifying schema..."
  VERIFY=$(curl -s -X POST "http://localhost:3477/v1/tenants/$TENANT_ID/schemas/read" \
    -H "Content-Type: application/json" \
    -d '{"metadata": {}}')
  
  HAS_SCHEMA=$(echo "$VERIFY" | jq -r 'if .schema then "✓ Schema exists" else "✗ No schema" end')
  echo "$HAS_SCHEMA"
  
  # Kill port-forward
  kill $PF_PID 2>/dev/null
  wait $PF_PID 2>/dev/null
  
  echo ""
done

echo "=========================================="
echo "Schema deployment complete for all pods!"
echo "=========================================="
