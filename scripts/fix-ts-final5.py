"""Final targeted fixes based on exact content inspection."""

def patch(filepath, replacements):
    try:
        with open(filepath) as f:
            content = f.read()
        original = content
        for old, new in replacements:
            content = content.replace(old, new)
        if content != original:
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"PATCHED: {filepath}")
        else:
            print(f"NO CHANGE: {filepath}")
    except FileNotFoundError:
        print(f"NOT FOUND: {filepath}")

# VelocityCheckDashboard - grantOverride needs userId field
patch('client/src/pages/VelocityCheckDashboard.tsx', [
    ('''      ruleId: Number(selectedCheck.id),
      reason: overrideReason,''',
     '''      ruleId: Number(selectedCheck.id),
      userId: 0,
      reason: overrideReason,'''),
])

# TenantAdmin - slug field doesn't exist on Tenant type, use name instead
patch('client/src/pages/TenantAdmin.tsx', [
    # Remove slug from create mutation input (it's not in the schema)
    ('''      slug: (formData.get('name') as string).toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      name: formData.get('name') as string,''',
     '''      name: formData.get('name') as string,'''),
    # Fix display of slug in table
    ('{(tenant as any).slug}', '{(tenant as any).name}'),
    # Fix edit form defaultValue
    ("defaultValue={selectedTenant?.slug}", "defaultValue={selectedTenant?.name}"),
    # Fix ownerUserId string vs number
    ('ownerUserId: formData.get(', 'ownerUserId: Number(formData.get('),
])

# RateAlertHistoryPage - toast({ title }) is wrong pattern, use toast.success/error
patch('client/src/pages/RateAlertHistoryPage.tsx', [
    ('toast({ title: "Alert snoozed", description: `Until ${format(new Date(r.snoozedUntil!), "MMM d, h:mm a")}` })',
     'toast.success(`Alert snoozed until ${format(new Date(r.snoozedUntil!), "MMM d, h:mm a")}`)'),
])

# LandingPage - authData?.user is the user object itself, not nested
patch('client/src/pages/LandingPage.tsx', [
    ('{authData?.user ?', '{authData ?'),
    ('authData?.user?.', 'authData?.'),
    ('authData.user.', 'authData.'),
])

# ComplianceMetricsDashboard - check what the actual error is
with open('client/src/pages/ComplianceMetricsDashboard.tsx') as f:
    content = f.read()
print("ComplianceMetricsDashboard trpc calls:")
for i, line in enumerate(content.split('\n'), 1):
    if 'trpc.' in line:
        print(f"  {i}: {line.strip()}")

# KYCLifecyclePage - check what the actual error is at line 136
with open('client/src/pages/KYCLifecyclePage.tsx') as f:
    content = f.read()
lines = content.split('\n')
print("\nKYCLifecyclePage lines 133-142:")
for i, line in enumerate(lines[132:142], 133):
    print(f"  {i}: {line}")

# FeatureFlagAdmin - check remaining error
with open('client/src/pages/FeatureFlagAdmin.tsx') as f:
    content = f.read()
print("\nFeatureFlagAdmin trpc calls:")
for i, line in enumerate(content.split('\n'), 1):
    if 'trpc.' in line or 'mutate' in line.lower():
        print(f"  {i}: {line.strip()}")

# Fix v94Features and v97Features Expected 2-3 args - z.record needs 2 args in zod v3
for fname in ['server/routers/v94Features.ts', 'server/routers/v97Features.ts']:
    with open(fname) as f:
        content = f.read()
    original = content
    content = content.replace('z.record(z.unknown())', 'z.record(z.string(), z.unknown())')
    if content != original:
        with open(fname, 'w') as f:
            f.write(content)
        print(f"PATCHED z.record: {fname}")
    else:
        # Check if it's already fixed
        if 'z.record(z.string(), z.unknown())' in content:
            print(f"Already fixed: {fname}")
        else:
            print(f"NO z.record found: {fname}")
            # Find any remaining z.record calls
            import re
            for m in re.finditer(r'z\.record\([^)]+\)', content):
                print(f"  Found: {m.group()}")

print("\nDone!")
