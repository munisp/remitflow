#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/workspace
RESULTS="$ROOT/.audit/container-validation"
MODE="${1:-all}"
mkdir -p "$RESULTS"

log() { printf '%s\n' "$*" | tee -a "$RESULTS/runner.log"; }
record() {
  local language="$1" subject="$2" state="$3" detail="$4"
  printf '%s\t%s\t%s\t%s\n' "$language" "$subject" "$state" "$detail" >> "$RESULTS/results.tsv"
}
run_case() {
  local language="$1" subject="$2"; shift 2
  log "[$language] $subject"
  if "$@" >"$RESULTS/${language}-$(echo "$subject" | tr '/ ' '__').log" 2>&1; then
    record "$language" "$subject" "PASS" "completed"
  else
    local code=$?
    record "$language" "$subject" "FAIL" "exit=$code"
    log "[$language] $subject failed; continuing to preserve full matrix evidence"
  fi
}

cd "$ROOT"
CACHE_ROOT="$ROOT/.audit/container-validation-cache"
mkdir -p "$CACHE_ROOT/go-modcache" "$CACHE_ROOT/go-buildcache" "$CACHE_ROOT/cargo-home" "$CACHE_ROOT/cargo-target"
printf 'language\tsubject\tstatus\tdetail\n' > "$RESULTS/results.tsv"
: > "$RESULTS/runner.log"

run_go() {
  export GOFLAGS='-buildvcs=false'
  export GOMODCACHE="$CACHE_ROOT/go-modcache"
  export GOCACHE="$CACHE_ROOT/go-buildcache"
  while IFS= read -r mod; do
    local dir
    dir=$(dirname "$mod")
    run_case go "${dir#./}" bash -c "cd '$ROOT/$dir' && go test -mod=mod ./..."
  done < <(find services microservices -path '*/target' -prune -o -path '*/vendor' -prune -o -path '*/node_modules' -prune -o -name go.mod -print | sort)
}

run_rust() {
  export CARGO_HOME="$CACHE_ROOT/cargo-home"
  export CARGO_TARGET_DIR="$CACHE_ROOT/cargo-target"
  while IFS= read -r manifest; do
    local dir
    dir=$(dirname "$manifest")
    run_case rust "${dir#./}" bash -c "cd '$ROOT/$dir' && cargo test --all-targets"
  done < <(find services microservices -path '*/target' -prune -o -path '*/vendor' -prune -o -path '*/node_modules' -prune -o -name Cargo.toml -print | sort)
}

run_python() {
  run_case python 'all-service-syntax' bash -c "python3 -m compileall -q services"

  local tests=(
    services/python-aml-scorer/test_aml_scorer.py
    services/python-anomaly-detector/test_anomaly.py
    services/python-anomaly-detector/test_anomaly_detector.py
    services/python-compliance-service/test_main.py
    services/python-deepfake-detector/test_deepfake_detector.py
    services/python-kyc-liveness/test_liveness_provider.py
    services/python-pix-adapter/test_pix_adapter.py
    services/python-str-generator/test_str_generator.py
    services/revenue-analytics/test_app.py
    services/universal-fx/test_main.py
  )
  for test_file in "${tests[@]}"; do
    [ -f "$test_file" ] || { record python "$test_file" "SKIP" "file-not-found"; continue; }
    local dir slug req
    dir=$(dirname "$test_file")
    slug=$(echo "$dir" | tr '/.' '__')
    req="$dir/requirements.txt"
    if [[ -f "$dir/requirements.test.txt" ]]; then
      req="$dir/requirements.test.txt"
    fi
    run_case python "$test_file" bash -c '
      set -Eeuo pipefail
      dir="$1"; test_file="$2"; req="$3"; venv="/tmp/venv-$(echo "$dir" | tr "/." "__")"
      rm -rf "$venv"
      trap "rm -rf \"$venv\"" EXIT
      python3 -m venv "$venv"
      "$venv/bin/pip" install --upgrade pip setuptools wheel pytest >/dev/null
      if [ -f "$req" ]; then "$venv/bin/pip" install -r "$req" >/dev/null; fi
      export DATABASE_URL="postgresql://test:test@127.0.0.1:5432/remitflow_test"
      export AML_DATABASE_URL="$DATABASE_URL"
      export REGULATORY_FILING_WORKER_ENABLED="false"
      export REMITFLOW_TEST_MODE="true"
      export PYTHONPATH="$dir${PYTHONPATH:+:$PYTHONPATH}"
      cd "$dir"
      "$venv/bin/python" -m pytest -q "$(basename "$test_file")"
    ' _ "$ROOT/$dir" "$ROOT/$test_file" "$ROOT/$req"
  done
  run_case python 'cilium-render-assertion' bash -c 'set -Eeuo pipefail; venv=/tmp/cilium-render-venv; rm -rf "$venv"; trap "rm -rf \"$venv\"" EXIT; python3 -m venv "$venv"; "$venv/bin/pip" install --quiet PyYAML; cd /workspace; "$venv/bin/python" infrastructure/cilium/tests/assert_rendered_manifests.py'
}

run_typescript() {
  run_case typescript 'dependency-install' bash -c "cd '$ROOT' && CI=1 pnpm install --frozen-lockfile --ignore-scripts --force"
  run_case typescript 'full-typecheck' bash -c "cd '$ROOT' && NODE_OPTIONS=--max-old-space-size=4096 pnpm check"
  run_case typescript 'production-build' bash -c "cd '$ROOT' && pnpm build"
  run_case typescript 'hardening-suite' bash -c "cd '$ROOT' && pnpm exec vitest run server/attached-requirements-hardening.test.ts --reporter=verbose"
}

case "$MODE" in
  go) run_go ;;
  rust) run_rust ;;
  python) run_python ;;
  typescript) run_typescript ;;
  all) run_go; run_rust; run_python; run_typescript ;;
  *) echo "Usage: $0 {go|rust|python|typescript|all}" >&2; exit 64 ;;
esac

awk -F '\t' 'NR>1 {counts[$1 FS $3]++} END {for (k in counts) print k, counts[k]}' "$RESULTS/results.tsv" | sort | tee "$RESULTS/summary.tsv"
if awk -F '\t' 'NR>1 && $3=="FAIL" {found=1} END {exit found?0:1}' "$RESULTS/results.tsv"; then
  log 'Completed with failures; inspect results.tsv and individual logs.'
  exit 1
fi
log 'Completed without recorded failures.'
