#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CILIUM_DIR="$ROOT_DIR/infrastructure/cilium"
POLICY_CHART="$ROOT_DIR/infrastructure/charts/remitflow-cilium-security"
CILIUM_NAMESPACE="${CILIUM_NAMESPACE:-kube-system}"
REMITFLOW_NAMESPACE="${REMITFLOW_NAMESPACE:-banking}"
CILIUM_RELEASE="${CILIUM_RELEASE:-cilium}"
POLICY_RELEASE="${POLICY_RELEASE:-remitflow-cilium-security}"
CILIUM_CHART_VERSION="${CILIUM_CHART_VERSION:-1.19.6}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is missing: %s\n' "$1" >&2
    exit 1
  }
}

require_command helm
require_command kubectl
"$CILIUM_DIR/scripts/validate.sh"

kubectl version --request-timeout=15s >/dev/null
kubectl get nodes -o wide

# This command intentionally excludes the kube-proxy replacement overlay. A
# planned new-cluster deployment must pass K8S_SERVICE_HOST and K8S_SERVICE_PORT
# plus NEW_CLUSTER_KUBE_PROXY_REPLACEMENT=true to use that overlay manually.
helm upgrade --install "$CILIUM_RELEASE" \
  oci://quay.io/cilium/charts/cilium \
  --version "$CILIUM_CHART_VERSION" \
  --namespace "$CILIUM_NAMESPACE" \
  --create-namespace \
  --values "$CILIUM_DIR/values.production.yaml" \
  --wait \
  --timeout 10m

kubectl -n "$CILIUM_NAMESPACE" rollout status daemonset/cilium --timeout=10m
kubectl -n "$CILIUM_NAMESPACE" rollout status deployment/cilium-operator --timeout=10m

policy_args=(
  upgrade --install "$POLICY_RELEASE" "$POLICY_CHART"
  --namespace "$REMITFLOW_NAMESPACE"
  --create-namespace
  --wait
  --timeout 5m
)

if [[ "${ENABLE_STRICT_POLICY_ENFORCEMENT:-false}" == "true" ]]; then
  [[ -n "${STRICT_POLICY_VALUES:-}" ]] || {
    printf 'STRICT_POLICY_VALUES is required when strict policy enforcement is enabled.\n' >&2
    exit 1
  }
  [[ -f "$STRICT_POLICY_VALUES" ]] || {
    printf 'Reviewed strict policy values file was not found: %s\n' "$STRICT_POLICY_VALUES" >&2
    exit 1
  }
  helm "${policy_args[@]}" \
    --values "$STRICT_POLICY_VALUES" \
    --set enforcement.enabled=true
  printf 'Strict policy enforcement was requested using reviewed values: %s\n' "$STRICT_POLICY_VALUES"
else
  helm "${policy_args[@]}" --set enforcement.enabled=false
  printf 'Cilium policies installed in observation mode. Strict default-deny remains disabled.\n'
fi

kubectl -n "$CILIUM_NAMESPACE" get pods -l k8s-app=cilium
kubectl -n "$CILIUM_NAMESPACE" get pods -l k8s-app=hubble-relay || true
