#!/bin/bash
set -e

echo "🚀 Deploying Nigerian Remittance Platform..."

# Variables
NAMESPACE=${NAMESPACE:-remittance}
RELEASE_NAME=${RELEASE_NAME:-remittance-platform}
HELM_CHART_PATH="./deployment/helm/remittance-platform"

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Add Helm repositories
echo "📦 Adding Helm repositories..."
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo add temporal https://temporalio.github.io/helm-charts
helm repo update

# Install/Upgrade the Helm chart
echo "📊 Installing Helm chart..."
helm upgrade --install $RELEASE_NAME $HELM_CHART_PATH \
  --namespace $NAMESPACE \
  --create-namespace \
  --wait \
  --timeout 10m \
  --values $HELM_CHART_PATH/values.yaml

# Wait for deployments to be ready
echo "⏳ Waiting for deployments to be ready..."
kubectl wait --for=condition=available --timeout=300s \
  deployment --all -n $NAMESPACE

# Display deployment status
echo "✅ Deployment complete!"
echo ""
echo "📊 Deployment Status:"
kubectl get pods -n $NAMESPACE
echo ""
echo "🌐 Services:"
kubectl get svc -n $NAMESPACE
echo ""
echo "🔗 Ingress:"
kubectl get ingress -n $NAMESPACE

echo ""
echo "🎉 Platform deployed successfully!"
