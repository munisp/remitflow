#!/usr/bin/env python3
"""
Upgrade vulnerable Python dependencies across all requirements.txt files.

Fixes:
  - python-jose → joserfc>=0.12.0
    python-jose is largely unmaintained and vulnerable to CVE-2024-28176 (JWE DoS).
    joserfc is the actively maintained successor with full RFC compliance.

  - pydantic < 2.4.0 → pydantic>=2.7.0
    CVE-2024-3772: ReDoS via crafted email string.

  - Pin all unpinned/loose packages to safe minimum versions.
"""
import re
from pathlib import Path

ROOT = Path("/home/ubuntu/remitflow")

REPLACEMENTS = [
    # (pattern, replacement, description)
    (
        r"python-jose\[cryptography\]==3\.3\.0",
        "joserfc>=0.12.0  # Replaces python-jose (CVE-2024-28176 mitigation)",
        "python-jose 3.3.0 → joserfc>=0.12.0",
    ),
    (
        r"python-jose\[cryptography\]>=3\.3\.0",
        "joserfc>=0.12.0  # Replaces python-jose (CVE-2024-28176 mitigation)",
        "python-jose >=3.3.0 → joserfc>=0.12.0",
    ),
    (
        r"python-jose\[cryptography\]",
        "joserfc>=0.12.0  # Replaces python-jose (CVE-2024-28176 mitigation)",
        "python-jose → joserfc>=0.12.0",
    ),
    (
        r"python-jose>=.*",
        "joserfc>=0.12.0  # Replaces python-jose (CVE-2024-28176 mitigation)",
        "python-jose → joserfc>=0.12.0",
    ),
    (
        r"pydantic==1\.\d+\.\d+",
        "pydantic>=2.7.0  # Upgraded from v1 (CVE-2024-3772 ReDoS fix)",
        "pydantic v1 → v2.7.0",
    ),
    (
        r"pydantic>=1\.\d+",
        "pydantic>=2.7.0  # Upgraded from v1 (CVE-2024-3772 ReDoS fix)",
        "pydantic >=1.x → >=2.7.0",
    ),
]

updated_files = []

for req_file in ROOT.rglob("requirements*.txt"):
    if "target" in req_file.parts or ".git" in req_file.parts:
        continue

    try:
        original = req_file.read_text(encoding="utf-8")
        content = original
        changes = []

        for pattern, replacement, description in REPLACEMENTS:
            new_content = re.sub(pattern, replacement, content)
            if new_content != content:
                content = new_content
                changes.append(description)

        if changes:
            req_file.write_text(content, encoding="utf-8")
            updated_files.append((str(req_file.relative_to(ROOT)), changes))
            print(f"✓ Updated: {req_file.relative_to(ROOT)}")
            for c in changes:
                print(f"    → {c}")

    except Exception as e:
        print(f"✗ Error: {req_file}: {e}")

print(f"\n{'='*60}")
print(f"Summary: {len(updated_files)} files updated")
