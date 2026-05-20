#!/bin/bash
set -e

echo "🚀 Deploying Platform-Wide KEDA Autoscaling..."

# Check prerequisites
echo "🔍 Checking prerequisites..."
kubectl version --client || { echo "❌ kubectl not found"; exit 1; }
helm version || { echo "❌ helm not found"; exit 1; }

# Install KEDA if not already installed
if ! kubectl get namespace keda-system &> /dev/null; then
    echo "📦 Installing KEDA..."
    helm repo add kedacore https://kedacore.github.io/charts
    helm repo update
    helm install keda kedacore/keda --namespace keda-system --create-namespace
    
    echo "⏳ Waiting for KEDA to be ready..."
    kubectl wait --for=condition=ready pod -l app=keda-operator -n keda-system --timeout=300s
else
    echo "✅ KEDA already installed"
fi

# Create namespace if it doesn't exist
kubectl create namespace remittance-platform --dry-run=client -o yaml | kubectl apply -f -

# Apply KEDA configuration
echo "⚙️ Applying KEDA configuration..."
kubectl apply -f infrastructure/keda-config.yaml

# Deploy Core Services Scalers
echo "🏦 Deploying Core Services KEDA Scalers..."
kubectl apply -f core-services/core-services-scalers.yaml
kubectl apply -f core-services/advanced-scalers.yaml

# Deploy PIX Services Scalers
echo "🇧🇷 Deploying PIX Services KEDA Scalers..."
kubectl apply -f pix-services/pix-services-scalers.yaml

# Deploy AI/ML Services Scalers
echo "🤖 Deploying AI/ML Services KEDA Scalers..."
kubectl apply -f ai-ml-services/ai-ml-scalers.yaml

# Deploy Infrastructure Scalers
echo "🏗️ Deploying Infrastructure KEDA Scalers..."
kubectl apply -f infrastructure/infrastructure-scalers.yaml

# Deploy Monitoring
echo "📊 Deploying KEDA Monitoring..."
kubectl apply -f monitoring/keda-monitoring.yaml

# Verify deployment
echo "🔍 Verifying KEDA deployment..."
kubectl get scaledobjects -n remittance-platform

# Check KEDA operator status
kubectl get pods -n keda-system

echo "✅ Platform-Wide KEDA Autoscaling deployed successfully!"
echo ""
echo "📊 Monitoring:"
echo "  - KEDA Metrics: kubectl port-forward svc/keda-operator-metrics-apiserver 8080:8080 -n keda-system"
echo "  - Grafana Dashboard: Available in monitoring namespace"
echo ""
echo "🔍 Useful Commands:"
echo "  - View ScaledObjects: kubectl get scaledobjects -n remittance-platform"
echo "  - View HPA status: kubectl get hpa -n remittance-platform"
echo "  - KEDA logs: kubectl logs -l app=keda-operator -n keda-system"
