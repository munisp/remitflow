"""
patch-middleware.py
───────────────────
Patches all router files that are missing audit logging and/or rate limiting
to import and use auditedProcedure / rateLimitedProcedure from _core/trpc.

Strategy:
  1. For each file, check if it already imports from _core/trpc.
  2. Add auditedProcedure and rateLimitedProcedure to the import if missing.
  3. Replace protectedProcedure.mutation( with auditedProcedure.mutation(
     (only for files missing audit logging).
  4. Replace adminProcedure.mutation( with auditedAdminProcedure.mutation(
     (only for files missing audit logging).
"""

import os, re

ROUTER_DIR = "server/routers"
TRPC_IMPORT_RE = re.compile(
    r'(import\s*\{[^}]*\}\s*from\s*["\']\.\./_core/trpc["\'])',
    re.DOTALL
)

# Files that already have audit logging — skip mutation replacement
ALREADY_AUDITED = {
    "productionV89.ts",  # has audit but missing rate limit — only add rate limit
    "v92Features.ts",    # has audit but missing rate limit
}

# Files to skip entirely (webhooks, public endpoints)
SKIP_FILES = {
    "microservices.ts",  # internal health/status router, not user-facing mutations
}

def patch_file(fpath: str) -> tuple[bool, str]:
    fname = os.path.basename(fpath)
    if fname in SKIP_FILES:
        return False, "skipped"

    content = open(fpath).read()
    original = content
    changed = False

    # ── 1. Fix import ──────────────────────────────────────────────────────────
    # Check what's currently imported from _core/trpc
    import_match = TRPC_IMPORT_RE.search(content)
    if import_match:
        import_block = import_match.group(0)
        new_imports_needed = []
        if "auditedProcedure" not in import_block:
            new_imports_needed.append("auditedProcedure")
        if "auditedAdminProcedure" not in import_block and "adminProcedure" in import_block:
            new_imports_needed.append("auditedAdminProcedure")
        if "rateLimitedProcedure" not in import_block:
            new_imports_needed.append("rateLimitedProcedure")

        if new_imports_needed:
            # Insert new imports before the closing }
            new_import_block = import_block.rstrip()
            # Find the closing brace of the import
            brace_pos = new_import_block.rfind("}")
            additions = ", ".join(new_imports_needed)
            new_import_block = (
                new_import_block[:brace_pos]
                + f",\n  {additions}\n"
                + new_import_block[brace_pos:]
            )
            content = content.replace(import_block, new_import_block, 1)
            changed = True
    else:
        # No existing _core/trpc import — add one at the top after the first import
        first_import_end = content.find("\n", content.find("import ")) + 1
        new_import = (
            'import { auditedProcedure, auditedAdminProcedure, rateLimitedProcedure }'
            ' from "../_core/trpc";\n'
        )
        content = content[:first_import_end] + new_import + content[first_import_end:]
        changed = True

    # ── 2. Replace procedure calls ────────────────────────────────────────────
    if fname not in ALREADY_AUDITED:
        # Replace protectedProcedure.mutation( → auditedProcedure.mutation(
        new_content = re.sub(
            r'\bprotectedProcedure\.mutation\(',
            'auditedProcedure.mutation(',
            content
        )
        if new_content != content:
            content = new_content
            changed = True

        # Replace adminProcedure.mutation( → auditedAdminProcedure.mutation(
        new_content = re.sub(
            r'\badminProcedure\.mutation\(',
            'auditedAdminProcedure.mutation(',
            content
        )
        if new_content != content:
            content = new_content
            changed = True

    # For files with audit but missing rate limit — replace queries too
    if fname in ALREADY_AUDITED:
        new_content = re.sub(
            r'\bprotectedProcedure\.mutation\(',
            'rateLimitedProcedure.mutation(',
            content
        )
        if new_content != content:
            content = new_content
            changed = True

    if changed:
        open(fpath, 'w').write(content)
        return True, "patched"
    return False, "no_change"


def main():
    files = [
        os.path.join(ROUTER_DIR, f)
        for f in sorted(os.listdir(ROUTER_DIR))
        if f.endswith(".ts") and "test" not in f and "spec" not in f
    ]

    patched = 0
    skipped = 0
    for fpath in files:
        ok, reason = patch_file(fpath)
        fname = os.path.basename(fpath)
        if ok:
            print(f"  ✓ {fname}: {reason}")
            patched += 1
        else:
            print(f"  - {fname}: {reason}")
            skipped += 1

    print(f"\nDone: {patched} patched, {skipped} skipped/no-change")


if __name__ == "__main__":
    main()
