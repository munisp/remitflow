#!/bin/bash
# Re-assign roles to users after schema update

set -e

# Configuration
NAMESPACE="${PERMIFY_NAMESPACE:-permify}"
TENANT_ID="${TENANT_ID:-bpmgd}"
PERMIFY_PORT="3476"

# User to assign roles to
USER_ID="${1:-}"
BANK_ID="${2:-$TENANT_ID}"

if [ -z "$USER_ID" ]; then
    echo "Usage: $0 <user_id> [bank_id]"
    echo ""
    echo "Example:"
    echo "  $0 03004859-44d0-4447-9d78-c20da127418c bpmgd"
    exit 1
fi

echo "🔄 Re-assigning roles for user: $USER_ID"
echo "🏢 Bank: $BANK_ID"
echo "📦 Namespace: $NAMESPACE"
echo ""

# Get first Permify pod
POD_NAME=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=permify -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POD_NAME" ]; then
    echo "❌ No Permify pods found"
    exit 1
fi

echo "✅ Using pod: $POD_NAME"

# Start port-forward in background
echo "🔄 Setting up port-forward..."
kubectl port-forward -n "$NAMESPACE" "$POD_NAME" "$PERMIFY_PORT:$PERMIFY_PORT" > /dev/null 2>&1 &
PORT_FORWARD_PID=$!

# Wait for port-forward to be ready
sleep 2

# Cleanup function
cleanup() {
    kill $PORT_FORWARD_PID 2>/dev/null || true
}
trap cleanup EXIT

# Assign bank admin role
PAYLOAD=$(jq -n \
  --arg tenant "$TENANT_ID" \
  --arg bank "$BANK_ID" \
  --arg user "$USER_ID" \
  '{tenant_id: $tenant, tuples: [{entity: {type: "bank", id: $bank}, relation: "admin", subject: {type: "user", id: $user}}]}')

echo "🚀 Assigning bank:admin role..."
RESPONSE=$(curl -s -X POST "http://localhost:$PERMIFY_PORT/v1/tenants/$TENANT_ID/data/write" \
    -H "Content-Type: application/json" \
    -d "$PAYLOAD")

echo "$RESPONSE" | jq -C '.' || echo "$RESPONSE"

echo ""
echo "✅ Role assignment complete!"
echo ""
echo "🧪 Test the permission:"
echo "kubectl exec -n $NAMESPACE $POD_NAME -- \\"
echo "  curl -s -X POST 'http://localhost:$PERMIFY_PORT/v1/tenants/$TENANT_ID/permissions/check' \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"entity\":{\"type\":\"bank\",\"id\":\"$BANK_ID\"},\"permission\":\"manage_compliance\",\"subject\":{\"type\":\"user\",\"id\":\"$USER_ID\"}}'"
