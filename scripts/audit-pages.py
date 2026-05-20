#!/usr/bin/env python3
"""Audit all page files for stub/empty content."""
import os
import re

pages_dir = "/home/ubuntu/remitflow/client/src/pages"
pages = []

for f in sorted(os.listdir(pages_dir)):
    if not f.endswith(".tsx"):
        continue
    path = os.path.join(pages_dir, f)
    content = open(path).read()
    trpc_calls = len(re.findall(r"trpc\.", content))
    lines = content.count("\n")
    
    # Check for stub indicators
    has_coming_soon = bool(re.search(r"coming soon|Coming Soon|🚧|work in progress|Work in Progress", content, re.I))
    has_todo = bool(re.search(r"\bTODO\b|\bSTUB\b|\bPLACEHOLDER\b", content))
    has_lorem = bool(re.search(r"lorem ipsum", content, re.I))
    is_thin = lines < 80 and trpc_calls <= 2
    
    stub_flags = []
    if has_coming_soon: stub_flags.append("coming_soon")
    if has_todo: stub_flags.append("todo")
    if has_lorem: stub_flags.append("lorem")
    if is_thin: stub_flags.append("thin")
    
    pages.append((lines, trpc_calls, f, stub_flags))

pages.sort()

print(f"{'Lines':>6} | {'tRPC':>4} | {'File':<50} | Flags")
print("-" * 90)
stubs = []
for lines, trpc, f, flags in pages:
    flag_str = ",".join(flags) if flags else ""
    marker = " <<<" if flags else ""
    print(f"{lines:6d} | {trpc:4d} | {f:<50} | {flag_str}{marker}")
    if flags:
        stubs.append(f)

print(f"\nTotal pages: {len(pages)}")
print(f"Pages with stub indicators: {len(stubs)}")
if stubs:
    print("\nStub pages:")
    for s in stubs:
        print(f"  - {s}")
