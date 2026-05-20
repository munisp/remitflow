#!/bin/bash
set -e

echo "🗑️  Undeploying Nigerian Remittance Platform..."

# Variables
NAMESPACE=${NAMESPACE:-remittance}
RELEASE_NAME=${RELEASE_NAME:-remittance-platform}

# Uninstall Helm release
echo "📦 Uninstalling Helm release..."
helm uninstall $RELEASE_NAME --namespace $NAMESPACE || true

# Delete namespace
echo "🗑️  Deleting namespace..."
kubectl delete namespace $NAMESPACE --ignore-not-found=true

echo "✅ Platform undeployed successfully!"
