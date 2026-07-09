#!/bin/bash

echo "Checking schema on each Permify pod individually..."
echo ""

for pod in $(kubectl get pods -n permify -o name | grep permify | sed 's|pod/||'); do
  echo "=== Pod: $pod ==="
  kubectl exec -n permify $pod -- curl -s -X POST "http://localhost:3476/v1/tenants/bpmgd/schemas/read" \
    -H "Content-Type: application/json" \
    -d '{"metadata": {}}' | jq -r 'if .schema then "SCHEMA EXISTS: version " + .schema.schema_version else "NULL - No schema" end'
  echo ""
done
