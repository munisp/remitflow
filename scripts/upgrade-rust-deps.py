#!/usr/bin/env python3
"""
Bulk-upgrade vulnerable Rust dependencies across all Cargo.toml files.

Upgrades:
  - sqlx 0.7.x  → 0.8.1  (fixes RUSTSEC-2024-0363: SQL injection via protocol overflow)
  - reqwest 0.11.x → 0.12 (fixes CVE-2024-32650: rustls infinite loop DoS via transitive dep)
"""
import re
import os
from pathlib import Path

ROOT = Path("/home/ubuntu/remitflow")

UPGRADES = [
    # (pattern, replacement, description)
    (
        r'sqlx\s*=\s*\{\s*version\s*=\s*"0\.7"',
        'sqlx = { version = "0.8.1"',
        "sqlx 0.7 → 0.8.1 (RUSTSEC-2024-0363)",
    ),
    (
        r'sqlx\s*=\s*\{\s*version\s*=\s*"0\.7\..*?"',
        'sqlx = { version = "0.8.1"',
        "sqlx 0.7.x → 0.8.1 (RUSTSEC-2024-0363)",
    ),
    (
        r'reqwest\s*=\s*\{\s*version\s*=\s*"0\.11"',
        'reqwest = { version = "0.12"',
        "reqwest 0.11 → 0.12 (CVE-2024-32650 transitive rustls fix)",
    ),
    (
        r'reqwest\s*=\s*\{\s*version\s*=\s*"0\.11\..*?"',
        'reqwest = { version = "0.12"',
        "reqwest 0.11.x → 0.12 (CVE-2024-32650 transitive rustls fix)",
    ),
]

# Also fix the feature flag: sqlx 0.8 renamed runtime-tokio-rustls → runtime-tokio
FEATURE_UPGRADES = [
    (
        r'"runtime-tokio-rustls"',
        '"runtime-tokio"',
        "sqlx 0.8 runtime feature rename",
    ),
    (
        r'"runtime-tokio-native-tls"',
        '"runtime-tokio"',
        "sqlx 0.8 runtime feature rename (native-tls)",
    ),
]

updated_files = []
errors = []

for cargo_toml in ROOT.rglob("Cargo.toml"):
    # Skip target directories and workspace root
    if "target" in cargo_toml.parts:
        continue

    try:
        original = cargo_toml.read_text(encoding="utf-8")
        content = original
        file_changed = False
        changes = []

        for pattern, replacement, description in UPGRADES:
            new_content = re.sub(pattern, replacement, content)
            if new_content != content:
                content = new_content
                file_changed = True
                changes.append(description)

        # Only apply feature renames to files that had sqlx upgraded
        if any("sqlx" in c for c in changes):
            for pattern, replacement, description in FEATURE_UPGRADES:
                new_content = re.sub(pattern, replacement, content)
                if new_content != content:
                    content = new_content
                    changes.append(description)

        if file_changed:
            cargo_toml.write_text(content, encoding="utf-8")
            updated_files.append((str(cargo_toml.relative_to(ROOT)), changes))
            print(f"✓ Updated: {cargo_toml.relative_to(ROOT)}")
            for change in changes:
                print(f"    → {change}")

    except Exception as e:
        errors.append((str(cargo_toml), str(e)))
        print(f"✗ Error: {cargo_toml}: {e}")

print(f"\n{'='*60}")
print(f"Summary: {len(updated_files)} files updated, {len(errors)} errors")
if errors:
    print("Errors:")
    for path, err in errors:
        print(f"  {path}: {err}")
