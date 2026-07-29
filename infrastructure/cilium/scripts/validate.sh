#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CILIUM_DIR="$ROOT_DIR/infrastructure/cilium"
POLICY_CHART="$ROOT_DIR/infrastructure/charts/remitflow-cilium-security"
NAMESPACE="${REMITFLOW_NAMESPACE:-banking}"

fail() {
  printf 'Cilium validation failed: %s\n' "$*" >&2
  exit 1
}

[[ -f "$CILIUM_DIR/values.production.yaml" ]] || fail "missing production values"
[[ -f "$POLICY_CHART/Chart.yaml" ]] || fail "missing policy Helm chart"

python3 "$CILIUM_DIR/scripts/reconcile_chart_labels.py" --check || \
  fail "one or more Helm charts are missing app.kubernetes.io/part-of=remitflow"

for pattern in \
  'encryption:' \
  'type: wireguard' \
  'nodeEncryption: true' \
  'policyEnforcementMode: default' \
  'networkPolicyCorrelation:' \
  'redact:' \
  'kubeProxyReplacement: false'; do
  grep -Fq "$pattern" "$CILIUM_DIR/values.production.yaml" || \
    fail "required Cilium production control absent: $pattern"
done

for template in "$POLICY_CHART"/templates/*.yaml; do
  grep -Fq 'kind: CiliumNetworkPolicy' "$template" || \
    fail "policy template does not render a CiliumNetworkPolicy: $template"
done

if command -v helm >/dev/null 2>&1; then
  helm lint "$POLICY_CHART" >/dev/null
  helm template remitflow-cilium-security "$POLICY_CHART" \
    --namespace "$NAMESPACE" \
    --set enforcement.enabled=true \
    > "$CILIUM_DIR/tests/rendered-policies.yaml"
  grep -Fq 'kind: CiliumNetworkPolicy' "$CILIUM_DIR/tests/rendered-policies.yaml" || \
    fail "Helm render did not produce Cilium policies"
  grep -Fq 'enableDefaultDeny:' "$CILIUM_DIR/tests/rendered-policies.yaml" || \
    fail "Helm render omitted default-deny enforcement"
  printf 'Cilium chart validation passed with Helm rendering.\n'
else
  printf 'Helm is unavailable; static Cilium validation passed. Run this script in CI or a cluster-admin workstation for Helm rendering.\n'
fi
