#!/bin/bash
USER_ID="d7d34674-7beb-4634-bad6-bd57179c9de3"
TENANT_ID="bpmgd"

kubectl port-forward -n permify svc/permify 3476:3476 > /dev/null 2>&1 &
PF_PID=$!
sleep 2

echo "=== Platform Relationships ==="
curl -s -X POST "http://localhost:3476/v1/tenants/${TENANT_ID}/data/relationships/read" \
  -H "Content-Type: application/json" \
  -d "{
    \"metadata\": {\"snap_token\": \"\"},
    \"filter\": {
      \"entity\": {\"type\": \"platform\", \"ids\": [\"${TENANT_ID}\"]},
      \"subject\": {\"type\": \"user\", \"ids\": [\"${USER_ID}\"]}
    }
  }" | jq '.tuples[]? // "No platform relationships found"'

echo ""
echo "=== Bank Relationships ==="
curl -s -X POST "http://localhost:3476/v1/tenants/${TENANT_ID}/data/relationships/read" \
  -H "Content-Type: application/json" \
  -d "{
    \"metadata\": {\"snap_token\": \"\"},
    \"filter\": {
      \"entity\": {\"type\": \"bank\", \"ids\": [\"${TENANT_ID}\"]},
      \"subject\": {\"type\": \"user\", \"ids\": [\"${USER_ID}\"]}
    }
  }" | jq '.tuples[]? // "No bank relationships found"'

kill $PF_PID 2>/dev/null
