#!/usr/bin/env python3
"""Static validation for controlled RemitFlow resilience and zero-trust assets.

This script intentionally performs no network I/O and never applies Kubernetes,
Terraform, or cloud changes. It verifies the artifacts that a staged environment
must render and run before an approved chaos, security, or DR exercise.
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ModuleNotFoundError as exc:
    raise SystemExit("PyYAML is required to validate Kubernetes YAML") from exc

ROOT = Path(__file__).resolve().parents[2]
errors: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def validate_chaos() -> None:
    docs = list(yaml.safe_load_all(read("infra/chaos/attached-requirements-drills.yaml")))
    require(len(docs) == 5, "expected five controlled attached-requirements chaos experiments")
    for doc in docs:
        metadata = doc.get("metadata", {})
        require(metadata.get("namespace") == "remitflow-staging", f"{metadata.get('name')} must target remitflow-staging")
        require("scheduler" not in doc.get("spec", {}), f"{metadata.get('name')} must remain manually applied, not scheduled")
        labels = metadata.get("labels", {})
        require(labels.get("app.kubernetes.io/part-of") == "remitflow", f"{metadata.get('name')} is missing platform identity")
        require("remitflow.io/runbook" in labels, f"{metadata.get('name')} is missing an evidence runbook")


def validate_gateway() -> None:
    plugin = read("infrastructure/apisix-resources/plugins/access.lua")
    route = read("infrastructure/apisix-resources/routes/account-service.yaml")
    require("exactly three bounded base64url segments" in plugin, "APISIX plugin lacks strict three-segment JWT guard")
    require("Query-string tokens" in plugin and "unsupported" in plugin, "APISIX plugin must forbid query-string tokens")
    require("Token from Authorization header:" not in plugin, "APISIX plugin must not log bearer tokens")
    require("require_tenant_claim: true" in route, "account route must bind authenticated token tenant claim")


def validate_dr() -> None:
    terraform = read("terraform/modules/backup-dr/main.tf")
    backup = ROOT / "services/backup-runner/backup.sh"
    restore = ROOT / "services/backup-runner/restore-drill.sh"
    require("object_lock_enabled = true" in terraform, "backup storage must enable Object Lock")
    require("aws_s3_bucket_replication_configuration" in terraform, "backup storage must replicate cross-region")
    require("COMPLIANCE" in terraform, "backup storage must use compliance retention")
    for script in (backup, restore):
        result = subprocess.run(["bash", "-n", str(script)], capture_output=True, text=True)
        require(result.returncode == 0, f"shell syntax failure in {script.relative_to(ROOT)}: {result.stderr.strip()}")
    require("RESTORE_TO_ISOLATED_ENVIRONMENT" in restore.read_text(encoding="utf-8"), "restore drill must require isolated-environment confirmation")


def validate_geospatial() -> None:
    migration = read("drizzle/0079_operational_geospatial.sql")
    router = read("server/routers/operationsMap.ts")
    page = read("uis/pwa/src/pages/OperationsMap.tsx")
    require("FORCE ROW LEVEL SECURITY" in migration, "operational map tables must force tenant RLS")
    require("auditedAdminProcedure" in router, "operational map router must require an audited administrator")
    require("maplibre-gl" in page, "operational map page must use MapLibre")
    require("VITE_MAP_STYLE_URL" in page, "operational map must use an explicit approved map-style endpoint")


def validate_cilium() -> None:
    values = read("infrastructure/cilium/values.production.yaml")
    policy = read("infrastructure/charts/remitflow-cilium-security/templates/policies.yaml")
    require("wireguard" in values.lower(), "Cilium production values must enable WireGuard controls")
    require("hubble" in values.lower(), "Cilium production values must enable Hubble controls")
    require("enableDefaultDeny" in policy, "Cilium policy chart must include explicit default-deny")


def main() -> int:
    validate_chaos()
    validate_gateway()
    validate_dr()
    validate_geospatial()
    validate_cilium()
    if errors:
        print("Attached-requirements asset validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Attached-requirements asset validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
