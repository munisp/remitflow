#!/bin/bash

# Quick check for Communication Hub database connection

NAMESPACE="54remit"
POD=$(kubectl get pods -n $NAMESPACE -l app=communication-hub -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)

if [ -z "$POD" ]; then
    echo "❌ No running pods found"
    kubectl get pods -n $NAMESPACE | grep communication-hub
    exit 1
fi

echo "Pod: $POD"
echo ""

echo "DATABASE_URL:"
kubectl exec $POD -n $NAMESPACE -- printenv DATABASE_URL 2>/dev/null | grep -oP '(?<=@)[^:]+' || echo "Not set"
echo ""

echo "Testing health endpoint:"
kubectl exec $POD -n $NAMESPACE -- wget -qO- http://localhost:8124/health 2>/dev/null | jq '.postgres' || echo "Failed"
echo ""

echo "Recent logs (database related):"
kubectl logs $POD -n $NAMESPACE --tail=20 | grep -i "database\|postgres\|connection"
