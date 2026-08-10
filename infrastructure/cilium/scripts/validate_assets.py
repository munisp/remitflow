#!/usr/bin/env python3
"""Validate RemitFlow's Cilium/eBPF repository artifacts without a live cluster."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
CILIUM = ROOT / "infrastructure" / "cilium"
CHART = ROOT / "infrastructure" / "charts" / "remitflow-cilium-security"
CHARTS = ROOT / "infrastructure" / "charts"


def load_yaml(path: Path) -> dict:
    try:
        document = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise RuntimeError(f"invalid YAML: {path.relative_to(ROOT)}: {exc}") from exc
    if not isinstance(document, dict):
        raise RuntimeError(f"expected YAML mapping: {path.relative_to(ROOT)}")
    return document


def require(value: object, expected: object, label: str, failures: list[str]) -> None:
    if value != expected:
        failures.append(f"{label}: expected {expected!r}, received {value!r}")


def main() -> int:
    failures: list[str] = []
    values = load_yaml(CILIUM / "values.production.yaml")
    policy_values = load_yaml(CHART / "values.yaml")
    chart = load_yaml(CHART / "Chart.yaml")
    new_cluster = load_yaml(CILIUM / "values.kube-proxy-replacement.yaml.example")

    require(chart.get("apiVersion"), "v2", "policy chart apiVersion", failures)
    require(values.get("policyEnforcementMode"), "default", "policy enforcement mode", failures)
    require(values.get("kubeProxyReplacement"), False, "base kube-proxy replacement", failures)
    require(values.get("l7Proxy"), True, "L7 proxy", failures)
    require(values.get("encryption", {}).get("enabled"), True, "encryption enabled", failures)
    require(values.get("encryption", {}).get("type"), "wireguard", "encryption type", failures)
    require(values.get("encryption", {}).get("nodeEncryption"), True, "node encryption", failures)
    require(values.get("hubble", {}).get("enabled"), True, "Hubble enabled", failures)
    require(values.get("hubble", {}).get("relay", {}).get("enabled"), True, "Hubble Relay enabled", failures)
    require(values.get("hubble", {}).get("ui", {}).get("enabled"), True, "Hubble UI enabled", failures)
    require(values.get("hubble", {}).get("redact", {}).get("enabled"), True, "Hubble redaction", failures)
    require(values.get("hubble", {}).get("tls", {}).get("enabled"), True, "Hubble TLS", failures)
    require(new_cluster.get("kubeProxyReplacement"), True, "new-cluster kube-proxy replacement", failures)
    require(policy_values.get("enforcement", {}).get("enabled"), False, "safe policy default", failures)

    all_helpers = sorted(CHARTS.glob("*/templates/_helpers.tpl"))
    part_of = [path for path in all_helpers if "app.kubernetes.io/part-of: remitflow" in path.read_text(encoding="utf-8")]
    if len(part_of) != len(all_helpers):
        failures.append(f"only {len(part_of)}/{len(all_helpers)} Helm chart helpers contain the RemitFlow identity label")

    strict = {
        path.parent.parent.name
        for path in all_helpers
        if "security.remitflow.io/network-policy: strict" in path.read_text(encoding="utf-8")
    }
    declared = {entry["name"] for entry in policy_values.get("coreServices", [])}
    expected_strict = declared | {policy_values["gateway"]["selector"]["app.kubernetes.io/name"], policy_values["api"]["selector"]["app.kubernetes.io/name"]}
    missing = expected_strict - strict
    if missing:
        failures.append(f"strict policy labels missing on declared critical charts: {', '.join(sorted(missing))}")

    template = (CHART / "templates" / "policies.yaml").read_text(encoding="utf-8")
    for marker in (
        "kind: CiliumNetworkPolicy",
        "enableDefaultDeny:",
        "fromEntities:",
        "toEndpoints:",
        "toFQDNs:",
        "rules:\n            dns:",
        "enforcement.enabled",
    ):
        if marker not in template:
            failures.append(f"policy template is missing expected safeguard: {marker}")

    if failures:
        print("Cilium asset validation failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print(
        "Cilium asset validation passed: "
        f"{len(part_of)} chart identities, {len(strict)} strict candidates, "
        f"{len(declared)} declared core service policies."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
