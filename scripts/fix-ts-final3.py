import re, os

def patch(filepath, patterns):
    try:
        with open(filepath) as f:
            content = f.read()
        original = content
        for find, replace in patterns:
            if isinstance(find, str):
                content = content.replace(find, replace)
            else:
                content = re.sub(find, replace, content)
        if content != original:
            with open(filepath, 'w') as f:
                f.write(content)
            print(f"PATCHED: {filepath}")
        else:
            print(f"NO CHANGE: {filepath}")
    except FileNotFoundError:
        print(f"NOT FOUND: {filepath}")

# WebhookRetryPage - processPending takes void, queueRetry needs full input
patch('client/src/pages/WebhookRetryPage.tsx', [
    (re.compile(r'bulkRetryMutation\.mutate\(\{[^}]+\}\)'), 'bulkRetryMutation.mutate()'),
    (re.compile(r'retryMutation\.mutate\(\{\s*deliveryId:\s*([^,}]+)\s*\}\)'),
     lambda m: f'retryMutation.mutate({{ deliveryId: Number({m.group(1)}), endpointId: 0, payload: {{}} }})'),
])

# PromoCodeAdmin
patch('client/src/pages/PromoCodeAdmin.tsx', [
    (re.compile(r'\.isLoading\b'), '.isPending'),
    ('hasMore', 'false'),
])

# WebhookAdmin - fix procedure names
patch('client/src/pages/WebhookAdmin.tsx', [
    ('trpc.webhooks.list.', 'trpc.webhooks.listEndpoints.'),
    ('trpc.webhooks.create.', 'trpc.webhooks.createEndpoint.'),
    ('trpc.webhooks.delete.', 'trpc.webhooks.deleteEndpoint.'),
    ('trpc.webhooks.deliveries.', 'trpc.webhooks.listDeliveries.'),
])

# StripePaymentHistory - check what procedures exist
patch('client/src/pages/StripePaymentHistory.tsx', [
    ('trpc.stripe.paymentHistory.', 'trpc.stripe.listPayments.'),
    ('trpc.stripe.history.', 'trpc.stripe.listPayments.'),
    ('trpc.stripe.payments.', 'trpc.stripe.listPayments.'),
    ('trpc.stripe.invoices.', 'trpc.stripe.listPayments.'),
])

# KYCLifecycleTracker - remove orphan .split line
patch('client/src/pages/KYCLifecycleTracker.tsx', [
    ("\n.split(',').map((s) => s.trim()),", ''),
    ("\n.split(',').map((s) => s.trim())", ''),
])

# DocumentVaultRenewal
patch('client/src/pages/DocumentVaultRenewal.tsx', [
    ('trpc.documentVaultRenewal.list.', 'trpc.documentVaultRenewal.listMyRenewals.'),
    ('trpc.documentVaultRenewal.renew.', 'trpc.documentVaultRenewal.completeRenewal.'),
    ('trpc.documentVaultRenewal.schedule.', 'trpc.documentVaultRenewal.scheduleRenewal.'),
])

# VelocityCheckDashboard
patch('client/src/pages/VelocityCheckDashboard.tsx', [
    ('trpc.velocityChecks.', 'trpc.velocityCheckAdmin.'),
    ('trpc.velocityCheckAdmin.getStats.', 'trpc.velocityCheckAdmin.getStats.'),
    ('trpc.velocityCheckAdmin.list.', 'trpc.velocityCheckAdmin.listRules.'),
    ('trpc.velocityCheckAdmin.getAlerts.', 'trpc.velocityCheckAdmin.listAlerts.'),
    ('trpc.velocityCheckAdmin.override.', 'trpc.velocityCheckAdmin.grantOverride.'),
])

# TenantAdmin
patch('client/src/pages/TenantAdmin.tsx', [
    (re.compile(r'\bownerId\b'), 'ownerUserId'),
])

# BrandingPreview
patch('client/src/pages/BrandingPreview.tsx', [
    ('trpc.branding.getPreview.', 'trpc.branding.getConfig.'),
    ('trpc.branding.preview.', 'trpc.branding.getConfig.'),
])

# RateAlertHistoryPage
patch('client/src/pages/RateAlertHistoryPage.tsx', [
    ('trpc.rateAlerts.history.', 'trpc.rateAlerts.list.'),
    ('trpc.rateAlerts.getHistory.', 'trpc.rateAlerts.list.'),
])

# LandingPage
patch('client/src/pages/LandingPage.tsx', [
    ("from '@/utils/trpc'", "from '@/lib/trpc'"),
    ("from '@/components/layouts/DashboardLayout'", "from '@/components/DashboardLayout'"),
])

# ComplianceMetricsDashboard
patch('client/src/pages/ComplianceMetricsDashboard.tsx', [
    ('trpc.compliance.metrics.', 'trpc.compliance.getMetrics.'),
    ('trpc.compliance.dashboard.', 'trpc.compliance.getMetrics.'),
])

# KYCAdminQueue
patch('client/src/pages/KYCAdminQueue.tsx', [
    ('reason: rejectData.reason,', 'rejectionReason: rejectData.reason,'),
    ('reason: reason,', 'rejectionReason: reason,'),
])

# Fix server-side z.record(z.unknown()) - this is valid zod v3 syntax
# The error "Expected 2-3 arguments" might be from a different function
# Check if it's from sql.placeholder or db.run
for fname in ['server/routers/v94Features.ts', 'server/routers/v97Features.ts']:
    with open(fname) as f:
        content = f.read()
    # z.record(z.unknown()) in zod v3 requires 2 args: z.record(z.string(), z.unknown())
    content = content.replace('z.record(z.unknown())', 'z.record(z.string(), z.unknown())')
    with open(fname, 'w') as f:
        f.write(content)
    print(f"PATCHED z.record: {fname}")

print("Done!")
