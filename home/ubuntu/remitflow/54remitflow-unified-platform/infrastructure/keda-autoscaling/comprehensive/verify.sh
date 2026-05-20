#!/bin/bash
set -e

echo "🔍 Verifying Platform-Wide KEDA Implementation..."

# Check KEDA operator
echo "📊 Checking KEDA Operator..."
kubectl get pods -n keda-system -l app=keda-operator

# Check ScaledObjects
echo "📈 Checking ScaledObjects..."
SCALEDOBJECTS=$(kubectl get scaledobjects -n remittance-platform --no-headers | wc -l)
echo "Found $SCALEDOBJECTS ScaledObjects"

if [ $SCALEDOBJECTS -lt 15 ]; then
    echo "⚠️ Expected at least 15 ScaledObjects, found $SCALEDOBJECTS"
else
    echo "✅ ScaledObjects count looks good"
fi

# Check HPA creation
echo "🎯 Checking HPA creation..."
HPAS=$(kubectl get hpa -n remittance-platform --no-headers | wc -l)
echo "Found $HPAS HPAs"

# Verify specific scalers
echo "🔍 Verifying specific scalers..."

CORE_SERVICES=("tigerbeetle-ledger" "api-gateway" "user-management" "notification-service")
PIX_SERVICES=("pix-gateway" "brl-liquidity-manager" "brazilian-compliance" "integration-orchestrator")
AI_ML_SERVICES=("gnn-fraud-detection" "risk-assessment" "ml-model-serving" "analytics-engine")

for service in "${CORE_SERVICES[@]}"; do
    if kubectl get scaledobject "${service}-scaler" -n remittance-platform &> /dev/null; then
        echo "✅ $service scaler found"
    else
        echo "❌ $service scaler missing"
    fi
done

for service in "${PIX_SERVICES[@]}"; do
    if kubectl get scaledobject "${service}-scaler" -n remittance-platform &> /dev/null; then
        echo "✅ $service scaler found"
    else
        echo "❌ $service scaler missing"
    fi
done

for service in "${AI_ML_SERVICES[@]}"; do
    if kubectl get scaledobject "${service}-scaler" -n remittance-platform &> /dev/null; then
        echo "✅ $service scaler found"
    else
        echo "❌ $service scaler missing"
    fi
done

# Check metrics availability
echo "📊 Checking metrics availability..."
if kubectl get --raw "/apis/external.metrics.k8s.io/v1beta1" &> /dev/null; then
    echo "✅ External metrics API available"
else
    echo "❌ External metrics API not available"
fi

# Test scaling behavior (dry run)
echo "🧪 Testing scaling behavior..."
kubectl describe scaledobject tigerbeetle-ledger-scaler -n remittance-platform | grep -A 10 "Triggers:"

echo ""
echo "🎉 KEDA Verification Complete!"
echo ""
echo "📊 Summary:"
echo "  - ScaledObjects: $SCALEDOBJECTS"
echo "  - HPAs: $HPAS"
echo "  - KEDA Operator: $(kubectl get pods -n keda-system -l app=keda-operator --no-headers | wc -l) pods"
echo ""
echo "🔍 Next Steps:"
echo "  1. Monitor scaling behavior in Grafana dashboard"
echo "  2. Adjust thresholds based on actual load patterns"
echo "  3. Set up alerting for scaling events"
echo "  4. Review and optimize scaling policies"
