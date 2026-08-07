#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-validate}"
: "${REMITFLOW_CONTROLLED_TEST_APPROVED:?Set REMITFLOW_CONTROLLED_TEST_APPROVED=true after an approved staging change record.}"
if [[ "$REMITFLOW_CONTROLLED_TEST_APPROVED" != "true" ]]; then
  echo "Controlled test approval must be exactly true." >&2
  exit 64
fi

case "$MODE" in
  validate)
    python3 "$ROOT/qa/attached-requirements/validate_assets.py"
    ;;
  load)
    : "${BASE_URL:?BASE_URL must target the approved staging/canary environment.}"
    : "${REMITFLOW_TEST_TENANT_ID:?Set the dedicated staging tenant identifier.}"
    : "${REMITFLOW_LOAD_TEST_TOKEN:?Set a short-lived, scoped staging test token.}"
    [[ "$BASE_URL" =~ staging|canary|sandbox ]] || { echo "BASE_URL must be a designated staging, canary, or sandbox target." >&2; exit 64; }
    command -v k6 >/dev/null || { echo "k6 is required for load mode." >&2; exit 69; }
    k6 run "$ROOT/k6/regulated-flow-load-test.js"
    ;;
  chaos-apply)
    : "${REMITFLOW_CHAOS_APPROVED:?Set REMITFLOW_CHAOS_APPROVED=true after the canary change approval.}"
    : "${KUBE_CONTEXT:?Set KUBE_CONTEXT to the approved staging context.}"
    [[ "$REMITFLOW_CHAOS_APPROVED" == "true" ]] || { echo "Chaos approval must be exactly true." >&2; exit 64; }
    [[ "$KUBE_CONTEXT" =~ staging|canary ]] || { echo "KUBE_CONTEXT must name a staging/canary context." >&2; exit 64; }
    command -v kubectl >/dev/null || { echo "kubectl is required for chaos-apply mode." >&2; exit 69; }
    kubectl --context "$KUBE_CONTEXT" get namespace remitflow-staging -o jsonpath='{.metadata.labels.remitflow\.io/chaos-approved}' | grep -qx "true" || {
      echo "remitflow-staging must have remitflow.io/chaos-approved=true." >&2; exit 65;
    }
    kubectl --context "$KUBE_CONTEXT" apply --server-side --dry-run=server -f "$ROOT/infra/chaos/attached-requirements-drills.yaml"
    kubectl --context "$KUBE_CONTEXT" apply --server-side -f "$ROOT/infra/chaos/attached-requirements-drills.yaml"
    ;;
  *)
    echo "Usage: $0 {validate|load|chaos-apply}" >&2
    exit 64
    ;;
esac
