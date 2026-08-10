#!/usr/bin/env bash
set -euo pipefail

CILIUM_NAMESPACE="${CILIUM_NAMESPACE:-kube-system}"
REMITFLOW_NAMESPACE="${REMITFLOW_NAMESPACE:-banking}"
POLICY_RELEASE="${POLICY_RELEASE:-remitflow-cilium-security}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is missing: %s\n' "$1" >&2
    exit 1
  }
}

require_command kubectl

kubectl -n "$CILIUM_NAMESPACE" rollout status daemonset/cilium --timeout=5m
kubectl -n "$CILIUM_NAMESPACE" rollout status deployment/cilium-operator --timeout=5m
kubectl -n "$CILIUM_NAMESPACE" rollout status deployment/hubble-relay --timeout=5m

printf '\n=== Cilium datapath status ===\n'
kubectl -n "$CILIUM_NAMESPACE" exec daemonset/cilium -- cilium-dbg status --wait

printf '\n=== WireGuard encryption status ===\n'
kubectl -n "$CILIUM_NAMESPACE" exec daemonset/cilium -- cilium-dbg status | grep -i 'Encryption:.*Wireguard'

printf '\n=== Hubble relay and UI ===\n'
kubectl -n "$CILIUM_NAMESPACE" get deployment hubble-relay hubble-ui
kubectl -n "$CILIUM_NAMESPACE" get svc hubble-relay hubble-ui

printf '\n=== RemitFlow policy resources ===\n'
kubectl -n "$REMITFLOW_NAMESPACE" get ciliumnetworkpolicies \
  -l app.kubernetes.io/instance="$POLICY_RELEASE"

printf '\n=== Strict-policy endpoints ===\n'
kubectl -n "$REMITFLOW_NAMESPACE" get pods \
  -l security.remitflow.io/network-policy=strict \
  -o custom-columns=NAME:.metadata.name,APP:.metadata.labels.app\\.kubernetes\\.io/name,READY:.status.containerStatuses[*].ready

printf '\n=== Recent policy verdicts (review before enabling more labels) ===\n'
kubectl -n "$CILIUM_NAMESPACE" exec deployment/hubble-relay -- \
  hubble observe --type policy-verdict --last 25 || true
