#!/usr/bin/env python3
"""Write all 13 v96 pages from the parallel generation results."""
import json, os

results = json.load(open("/home/ubuntu/build_v96_pages.json"))

pages_dir = "/home/ubuntu/remitflow/client/src/pages"
os.makedirs(pages_dir, exist_ok=True)

written = []
for item in results["results"]:
    out = item.get("output", {})
    file_path = out.get("file_path", "").strip()
    content = out.get("file_content", "").strip()
    
    if not file_path or not content:
        print(f"SKIP: empty result for {item.get('input','')[:50]}")
        continue
    
    # Extract just the filename from the path
    filename = os.path.basename(file_path)
    dest = os.path.join(pages_dir, filename)
    
    # Remove FILE: prefix if present in content
    if content.startswith("FILE:"):
        lines = content.split("\n")
        content = "\n".join(lines[1:]).strip()
    
    with open(dest, "w") as f:
        f.write(content)
    
    written.append(filename)
    print(f"Written: {filename} ({len(content)} chars)")

print(f"\nTotal pages written: {len(written)}")
print("Pages:", written)
