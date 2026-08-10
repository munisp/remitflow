#!/usr/bin/env python3
"""Add the stable RemitFlow workload label to every Helm chart helper.

Cilium policy selectors depend on immutable workload identity.  The Helm charts
already emit the Kubernetes recommended labels; this tool adds the shared
`app.kubernetes.io/part-of: remitflow` label to the common label helper without
changing selector labels or release-specific identity.
"""

from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CHARTS = ROOT / "infrastructure" / "charts"
TARGET = "app.kubernetes.io/managed-by: {{ .Release.Service }}"
LABEL = "app.kubernetes.io/part-of: remitflow"


def reconcile(check: bool) -> tuple[int, list[Path]]:
    changed: list[Path] = []
    for helper in sorted(CHARTS.glob("*/templates/_helpers.tpl")):
        source = helper.read_text(encoding="utf-8")
        if LABEL in source:
            continue
        if TARGET not in source:
            raise RuntimeError(
                f"{helper.relative_to(ROOT)} does not contain the expected shared-label anchor"
            )
        updated = source.replace(TARGET, f"{TARGET}\n{LABEL}", 1)
        changed.append(helper)
        if not check:
            helper.write_text(updated, encoding="utf-8")
    return len(changed), changed


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="report helpers that still need the RemitFlow policy label",
    )
    args = parser.parse_args()
    count, files = reconcile(args.check)
    action = "would update" if args.check else "updated"
    print(f"{action} {count} Helm chart helper(s)")
    for file in files:
        print(file.relative_to(ROOT))
    return 1 if args.check and count else 0


if __name__ == "__main__":
    raise SystemExit(main())
