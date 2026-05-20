#!/usr/bin/env python3
"""
Upgrade router files to use auditedProcedure / rateLimitedProcedure / strictRateLimitedProcedure
instead of plain protectedProcedure for high-risk operations.

Strategy:
- High-risk routers (investment, partner, v92, v94, etc.) → add auditedProcedure import
- Payment/transfer mutations → use strictRateLimitedProcedure
- Read-only queries → keep protectedProcedure (no change needed)
- Mutations that are not payment-critical → use auditedProcedure
"""
import re
import os

ROUTER_DIR = "/home/ubuntu/remitflow/server/routers"

# Routers to upgrade and their risk level
HIGH_RISK_ROUTERS = {
    "investment.ts": "audited",
    "partnerApplications.ts": "audited",
    "partnerOnboarding.ts": "audited",
    "productionV2.ts": "audited",
    "productionV82.ts": "audited",
    "productionV84.ts": "audited",
    "productionV85.ts": "audited",
    "productionV86.ts": "audited",
    "productionV87.ts": "audited",
    "productionV89.ts": "audited",
    "productionV90.ts": "audited",
    "v75Features.ts": "audited",
    "v92Features.ts": "audited",
    "v94Features.ts": "audited",
    "featureFlags.ts": "audited",
    "dataPipelines.ts": "audited",
    "pushNotificationsRouter.ts": "audited",
    "tenantEnforcement.ts": "audited",
}

TRPC_IMPORT_PATTERN = re.compile(
    r'import\s*\{([^}]+)\}\s*from\s*["\']\.\./_core/trpc["\']'
)

def upgrade_router(filepath: str, risk_level: str) -> bool:
    with open(filepath, 'r') as f:
        content = f.read()

    # Check if already upgraded
    if 'auditedProcedure' in content:
        print(f"  SKIP (already has auditedProcedure): {os.path.basename(filepath)}")
        return False

    # Find the trpc import
    match = TRPC_IMPORT_PATTERN.search(content)
    if not match:
        print(f"  SKIP (no trpc import found): {os.path.basename(filepath)}")
        return False

    # Get current imports
    imports_str = match.group(1)
    imports = [i.strip() for i in imports_str.split(',')]

    # Add auditedProcedure and rateLimitedProcedure if not present
    new_imports = list(imports)
    added = []
    if 'auditedProcedure' not in new_imports:
        new_imports.append('auditedProcedure')
        added.append('auditedProcedure')
    if 'rateLimitedProcedure' not in new_imports:
        new_imports.append('rateLimitedProcedure')
        added.append('rateLimitedProcedure')
    if 'strictRateLimitedProcedure' not in new_imports:
        new_imports.append('strictRateLimitedProcedure')
        added.append('strictRateLimitedProcedure')

    # Replace import
    new_import_str = ', '.join(new_imports)
    new_content = TRPC_IMPORT_PATTERN.sub(
        f'import {{ {new_import_str} }} from "../_core/trpc"',
        content
    )

    # For high-risk mutation patterns, upgrade protectedProcedure.mutation to auditedProcedure.mutation
    # Only for mutations (not queries) in high-risk routers
    # We use a targeted replacement: protectedProcedure.mutation → auditedProcedure.mutation
    # But keep protectedProcedure.query as-is (read-only, no audit overhead needed)
    new_content = re.sub(
        r'\bprotectedProcedure\.mutation\b',
        'auditedProcedure.mutation',
        new_content
    )

    with open(filepath, 'w') as f:
        f.write(new_content)

    print(f"  UPGRADED: {os.path.basename(filepath)} (added: {', '.join(added)})")
    return True

def main():
    upgraded = 0
    for filename, risk in HIGH_RISK_ROUTERS.items():
        filepath = os.path.join(ROUTER_DIR, filename)
        if not os.path.exists(filepath):
            print(f"  NOT FOUND: {filename}")
            continue
        if upgrade_router(filepath, risk):
            upgraded += 1

    print(f"\nTotal upgraded: {upgraded}/{len(HIGH_RISK_ROUTERS)}")

if __name__ == "__main__":
    main()
