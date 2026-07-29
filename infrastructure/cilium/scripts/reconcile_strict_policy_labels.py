#!/usr/bin/env python3
"""Mark the reviewed RemitFlow critical-service charts for strict Cilium policy.

The policy chart remains non-enforcing by default.  These labels only identify
workloads that have a defined baseline policy graph when an operator later sets
`enforcement.enabled=true` after Hubble audit review.
"""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CHARTS = ROOT / "infrastructure" / "charts"
CRITICAL_CHARTS = {
    "gateway-config",
    "transfer-engine",
    "auth-service",
    "user-service",
    "ledger-service",
    "risk-engine",
    "shared-middleware",
    "travel-rule-service",
    "tenant-management",
    "aml-engine",
    "fx-engine",
}
ANCHOR = "app.kubernetes.io/part-of: remitflow"
LABEL = "security.remitflow.io/network-policy: strict"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    missing: list[Path] = []
    for chart in sorted(CRITICAL_CHARTS):
        helper = CHARTS / chart / "templates" / "_helpers.tpl"
        source = helper.read_text(encoding="utf-8")
        if LABEL in source:
            continue
        if ANCHOR not in source:
            raise RuntimeError(f"missing RemitFlow label anchor: {helper.relative_to(ROOT)}")
        missing.append(helper)
        if not args.check:
            helper.write_text(source.replace(ANCHOR, f"{ANCHOR}\n{LABEL}", 1), encoding="utf-8")

    action = "would update" if args.check else "updated"
    print(f"{action} {len(missing)} critical Helm chart helper(s)")
    for helper in missing:
        print(helper.relative_to(ROOT))
    return 1 if args.check and missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
