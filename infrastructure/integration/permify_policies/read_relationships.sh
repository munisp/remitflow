#!/bin/bash

# Script to read relationships from Permify
# Usage: ./read_relationships.sh [tenant_id] [filter_type] [filter_value]
# Examples:
#   ./read_relationships.sh bpmgd entity bank:bpmgd
#   ./read_relationships.sh bpmgd subject user:03004859-44d0-4447-9d78-c20da127418c
#   ./read_relationships.sh bpmgd all

TENANT_ID="${1:-bpmgd}"
FILTER_TYPE="${2:-all}"
FILTER_VALUE="${3:-}"

# Check if port-forward is running
if ! curl -s http://localhost:3476/healthz > /dev/null 2>&1; then
    echo "Error: Permify not accessible on localhost:3476"
    echo "Start port-forward first: kubectl port-forward -n permify svc/permify 3476:3476"
    exit 1
fi

echo "Reading relationships for tenant: $TENANT_ID"
echo "Filter: $FILTER_TYPE $FILTER_VALUE"
echo ""

if [ "$FILTER_TYPE" = "all" ]; then
    # Read all relationships for the tenant
    curl -X POST "http://localhost:3476/v1/tenants/$TENANT_ID/data/relationships/read" \
      -H "Content-Type: application/json" \
      -d '{
        "metadata": {
          "snap_token": ""
        },
        "filter": {}
      }' | jq '.'
elif [ "$FILTER_TYPE" = "entity" ]; then
    # Parse type and id from format "type:id"
    ENTITY_TYPE=$(echo "$FILTER_VALUE" | cut -d: -f1)
    ENTITY_ID=$(echo "$FILTER_VALUE" | cut -d: -f2)
    
    curl -X POST "http://localhost:3476/v1/tenants/$TENANT_ID/data/relationships/read" \
      -H "Content-Type: application/json" \
      -d '{
        "metadata": {
          "snap_token": ""
        },
        "filter": {
          "entity": {
            "type": "'"$ENTITY_TYPE"'",
            "ids": ["'"$ENTITY_ID"'"]
          }
        }
      }' | jq '.'
elif [ "$FILTER_TYPE" = "subject" ]; then
    # Parse type and id from format "type:id"
    SUBJECT_TYPE=$(echo "$FILTER_VALUE" | cut -d: -f1)
    SUBJECT_ID=$(echo "$FILTER_VALUE" | cut -d: -f2)
    
    curl -X POST "http://localhost:3476/v1/tenants/$TENANT_ID/data/relationships/read" \
      -H "Content-Type: application/json" \
      -d '{
        "metadata": {
          "snap_token": ""
        },
        "filter": {
          "subject": {
            "type": "'"$SUBJECT_TYPE"'",
            "ids": ["'"$SUBJECT_ID"'"]
          }
        }
      }' | jq '.'
else
    echo "Error: Invalid filter type. Use: all|entity|subject"
    exit 1
fi
