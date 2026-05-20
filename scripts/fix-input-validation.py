#!/usr/bin/env python3
"""
v121 Security Hardening: Apply input validation bounds to high-risk free-text inputs.
Only targets user-facing free-text fields, not system identifiers.
"""
import re
import os

# Files to patch and their specific patterns
PATCHES = [
    # routers.ts - main router file
    {
        "file": "server/routers.ts",
        "replacements": [
            # notifyOwner title/content
            (r"title: z\.string\(\), content: z\.string\(\)", "title: z.string().min(1).max(200).trim(), content: z.string().min(1).max(2000).trim()"),
            # savings goal name
            (r"name: z\.string\(\), amount: z\.number\(\)\.positive\(\),", "name: z.string().min(1).max(100).trim(), amount: z.number().positive(),"),
            # support message
            (r"message: z\.string\(\),\n\s*category: z\.string\(\)", "message: z.string().min(1).max(2000).trim(),\n      category: z.string().min(1).max(50)"),
            # kyc uploadDocument
            (r"type: z\.string\(\), fileBase64: z\.string\(\), fileName: z\.string\(\), mimeType: z\.string\(\)", "type: z.string().min(1).max(50), fileBase64: z.string().max(10_000_000), fileName: z.string().min(1).max(255).trim(), mimeType: z.string().min(1).max(100)"),
            # uploadAvatar
            (r"fileBase64: z\.string\(\), mimeType: z\.string\(\)", "fileBase64: z.string().max(5_000_000), mimeType: z.string().min(1).max(100)"),
            # changePin
            (r"currentPin: z\.string\(\), newPin: z\.string\(\)", "currentPin: z.string().min(4).max(8), newPin: z.string().min(4).max(8)"),
            # verify2fa / disable2fa code
            (r"verify2fa: protectedProcedure\.input\(z\.object\(\{ code: z\.string\(\) \}\)\)", "verify2fa: protectedProcedure.input(z.object({ code: z.string().min(6).max(8) }))"),
            # send money recipientName/Account/Bank
            (r"recipientName: z\.string\(\),\n\s*recipientAccount: z\.string\(\),\n\s*recipientBank: z\.string\(\)", "recipientName: z.string().min(1).max(200).trim(),\n      recipientAccount: z.string().min(1).max(100).trim(),\n      recipientBank: z.string().min(1).max(200).trim()"),
        ]
    },
    # v94Features.ts
    {
        "file": "server/routers/v94Features.ts",
        "replacements": [
            (r"name: z\.string\(\),\n", "name: z.string().min(1).max(100).trim(),\n"),
        ]
    },
    # v101Features.ts
    {
        "file": "server/routers/v101Features.ts",
        "replacements": [
            (r"reason: z\.string\(\) \}\)\)", "reason: z.string().min(1).max(500).trim() })"),
        ]
    },
    # productionV82.ts
    {
        "file": "server/routers/productionV82.ts",
        "replacements": [
            (r"notes: z\.string\(\),", "notes: z.string().min(0).max(1000).trim(),"),
            (r"reference: z\.string\(\), description: z\.string\(\)", "reference: z.string().min(1).max(100).trim(), description: z.string().min(0).max(500).trim()"),
        ]
    },
]

base = "/home/ubuntu/remitflow"
total_changes = 0

for patch in PATCHES:
    filepath = os.path.join(base, patch["file"])
    if not os.path.exists(filepath):
        print(f"  SKIP (not found): {patch['file']}")
        continue
    with open(filepath, "r") as f:
        content = f.read()
    original = content
    for pattern, replacement in patch["replacements"]:
        new_content = re.sub(pattern, replacement, content)
        if new_content != content:
            total_changes += 1
            print(f"  ✅ {patch['file']}: applied '{pattern[:60]}...'")
        content = new_content
    if content != original:
        with open(filepath, "w") as f:
            f.write(content)
        print(f"  💾 Saved {patch['file']}")

print(f"\n✅ Total replacements applied: {total_changes}")
