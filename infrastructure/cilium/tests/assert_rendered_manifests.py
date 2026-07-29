#!/usr/bin/env python3
"""Assert the security-relevant properties of rendered Cilium manifests."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
TESTS = ROOT / "infrastructure" / "cilium" / "tests"


def documents(path: Path) -> list[dict]:
    return [doc for doc in yaml.safe_load_all(path.read_text(encoding="utf-8")) if isinstance(doc, dict)]


def named(docs: list[dict], kind: str, name: str) -> dict:
    for doc in docs:
        if doc.get("kind") == kind and doc.get("metadata", {}).get("name") == name:
            return doc
    raise AssertionError(f"missing {kind}/{name}")


def config_data(docs: list[dict], name: str) -> dict:
    return named(docs, "ConfigMap", name).get("data", {})


def main() -> int:
    cilium_docs = documents(TESTS / "rendered-cilium.yaml")
    policy_docs = documents(TESTS / "rendered-policies.yaml")

    operator = named(cilium_docs, "Deployment", "cilium-operator")
    relay = named(cilium_docs, "Deployment", "hubble-relay")
    assert operator["spec"]["replicas"] == 2, "cilium-operator must run two replicas"
    assert relay["spec"]["replicas"] == 2, "hubble-relay must run two replicas"

    config = config_data(cilium_docs, "cilium-config")
    for key, expected in {
        "enable-wireguard": "true",
        "encrypt-node": "true",
        "enable-l7-proxy": "true",
    }.items():
        assert config.get(key) == expected, f"Cilium config is missing {key}={expected}"

    kinds = [doc.get("kind") for doc in policy_docs]
    assert kinds.count("CiliumNetworkPolicy") == 14, "strict policy render must contain all baseline policies"
    default_deny = named(policy_docs, "CiliumNetworkPolicy", "remitflow-cilium-security-remitflow-cilium-security-default-deny")
    assert default_deny["spec"]["enableDefaultDeny"] == {"ingress": True, "egress": True}

    print(
        "Rendered Cilium manifests passed: two operator replicas, two relay replicas, "
        "WireGuard/node encryption/L7 proxy agent flags, and fourteen strict policies."
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, KeyError, TypeError) as error:
        print(f"Rendered manifest assertion failed: {error}", file=sys.stderr)
        raise SystemExit(1)
