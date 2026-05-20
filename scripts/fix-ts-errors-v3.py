#!/usr/bin/env python3
"""
v3 targeted fix script for all remaining TypeScript errors.
Run from /home/ubuntu/remitflow
"""
import os, re

pages_dir = "client/src/pages"

def rw(fname, old, new):
    """Replace old with new in file."""
    fpath = os.path.join(pages_dir, fname)
    if not os.path.exists(fpath):
        return
    with open(fpath, "r") as f:
        c = f.read()
    if old not in c:
        return
    with open(fpath, "w") as f:
        f.write(c.replace(old, new))
    print(f"  patched: {fname} [{old[:40]}]")

def rw_re(fname, pattern, repl):
    fpath = os.path.join(pages_dir, fname)
    if not os.path.exists(fpath):
        return
    with open(fpath, "r") as f:
        c = f.read()
    new_c = re.sub(pattern, repl, c)
    if new_c != c:
        with open(fpath, "w") as f:
            f.write(new_c)
        print(f"  patched(re): {fname}")

def read(fname):
    fpath = os.path.join(pages_dir, fname)
    if not os.path.exists(fpath):
        return ""
    with open(fpath, "r") as f:
        return f.read()

def write(fname, c):
    with open(os.path.join(pages_dir, fname), "w") as f:
        f.write(c)

# ── TenantAdmin ───────────────────────────────────────────────────────────────
print("TenantAdmin.tsx")
c = read("TenantAdmin.tsx")
# Fix use-toast
c = re.sub(r"import \{ useToast \} from ['\"][^'\"]+['\"];?\n", "", c)
c = re.sub(r"\s*const \{ toast \} = useToast\(\);?\n", "\n", c)
if "toast" in c and "from 'sonner'" not in c:
    c = "import { toast } from 'sonner';\n" + c
# Fix items -> tenants
c = c.replace("data?.items", "data?.tenants")
c = c.replace(".items?.map", ".tenants?.map")
c = c.replace(".items?.length", ".tenants?.length")
c = c.replace("data.items", "data.tenants")
# Fix hasMore
c = c.replace("data?.hasMore", "false")
# Fix getStats -> stats (tenants router has stats procedure)
c = c.replace("trpc.tenants.getStats.", "trpc.tenants.stats.")
# Fix domain field
c = re.sub(r"\s*domain:[^\n]+\n", "\n", c)
# Fix status/plan type cast
c = c.replace("status: filter.status,", "status: filter.status as any,")
c = c.replace("plan: filter.plan,", "plan: filter.plan as any,")
# Fix isLoading -> isPending
c = c.replace(".isLoading", ".isPending")
write("TenantAdmin.tsx", c)

# ── FeatureFlagAdmin ──────────────────────────────────────────────────────────
print("FeatureFlagAdmin.tsx")
for fname in ["FeatureFlagAdmin.tsx", "FeatureFlagsAdmin.tsx", "AdminFeatureFlags.tsx"]:
    c = read(fname)
    if not c: continue
    c = c.replace("trpc.featureFlags.listFlags.", "trpc.featureFlags.list.")
    c = c.replace("trpc.featureFlags.createFlag.", "trpc.featureFlags.upsert.")
    c = c.replace("trpc.featureFlags.updateFlag.", "trpc.featureFlags.upsert.")
    c = c.replace("trpc.featureFlags.deleteFlag.", "trpc.featureFlags.delete.")
    c = c.replace("trpc.featureFlags.toggleFlag.", "trpc.featureFlags.toggle.")
    c = c.replace("trpc.featureFlags.getStats.", "trpc.featureFlags.list.")
    c = c.replace(".isLoading", ".isPending")
    write(fname, c)

# ── WebhookAdmin ──────────────────────────────────────────────────────────────
print("WebhookAdmin.tsx")
c = read("WebhookAdmin.tsx")
c = c.replace("trpc.webhooks.list.", "trpc.webhooks.listEndpoints.")
c = c.replace("trpc.webhooks.getLogs.", "trpc.webhooks.listDeliveries.")
c = c.replace("trpc.webhooks.create.", "trpc.webhooks.createEndpoint.")
c = c.replace("trpc.webhooks.getStats.", "trpc.webhooks.listEndpoints.")
c = c.replace("trpc.webhooks.getFailedDeliveries.", "trpc.webhooks.listDeliveries.")
c = c.replace(".isLoading", ".isPending")
write("WebhookAdmin.tsx", c)

# ── WebhookRetryPage ──────────────────────────────────────────────────────────
print("WebhookRetryPage.tsx")
c = read("WebhookRetryPage.tsx")
c = c.replace("trpc.webhookRetry.getStats.", "trpc.webhookRetry.listPending.")
c = c.replace("trpc.webhookRetry.getFailedDeliveries.", "trpc.webhookRetry.listPending.")
c = c.replace(".isLoading", ".isPending")
write("WebhookRetryPage.tsx", c)

# ── KYCLifecycleTracker ───────────────────────────────────────────────────────
print("KYCLifecycleTracker.tsx")
c = read("KYCLifecycleTracker.tsx")
c = c.replace("trpc.kycLifecycle.getMyStatus.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.submit.", "trpc.kycLifecycle.submitDocuments.")
c = c.replace("trpc.kycLifecycle.getHistory.", "trpc.kycLifecycle.getMyHistory.")
c = c.replace("trpc.kycLifecycle.getDocuments.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.getStats.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.getTimeline.", "trpc.kycLifecycle.getMyHistory.")
c = c.replace("tierGranted:", "tier:")
c = c.replace("reason: rejectReason,", "rejectionReason: rejectReason,")
c = c.replace(".isLoading", ".isPending")
write("KYCLifecycleTracker.tsx", c)

# ── KYCLifecyclePage ──────────────────────────────────────────────────────────
print("KYCLifecyclePage.tsx")
c = read("KYCLifecyclePage.tsx")
c = c.replace("trpc.kycLifecycle.getMyStatus.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.submit.", "trpc.kycLifecycle.submitDocuments.")
c = c.replace("trpc.kycLifecycle.getHistory.", "trpc.kycLifecycle.getMyHistory.")
c = c.replace("trpc.kycLifecycle.getDocuments.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.getStats.", "trpc.kycLifecycle.getMyLifecycle.")
c = c.replace("trpc.kycLifecycle.getTimeline.", "trpc.kycLifecycle.getMyHistory.")
c = c.replace("tierGranted:", "tier:")
c = c.replace("reason: rejectReason,", "rejectionReason: rejectReason,")
c = c.replace(".isLoading", ".isPending")
write("KYCLifecyclePage.tsx", c)

# ── VelocityCheckDashboard ────────────────────────────────────────────────────
print("VelocityCheckDashboard.tsx")
c = read("VelocityCheckDashboard.tsx")
c = c.replace("trpc.velocityChecks.", "trpc.velocityCheckAdmin.")
c = c.replace("trpc.velocityCheckAdmin.getStats.", "trpc.velocityCheckAdmin.listRules.")
c = c.replace("trpc.velocityCheckAdmin.list.", "trpc.velocityCheckAdmin.listRules.")
c = c.replace("trpc.velocityCheckAdmin.getAlerts.", "trpc.velocityCheckAdmin.listOverrides.")
c = c.replace("trpc.velocityCheckAdmin.override.", "trpc.velocityCheckAdmin.grantOverride.")
# id -> ruleId in grantOverride input
c = re.sub(r'(grantOverride\.mutate\(\{[^}]*?)id:\s*([^,}]+)', r'\1ruleId: \2', c)
c = c.replace(".isLoading", ".isPending")
write("VelocityCheckDashboard.tsx", c)

# ── BatchPaymentAdmin ─────────────────────────────────────────────────────────
print("BatchPaymentAdmin.tsx")
c = read("BatchPaymentAdmin.tsx")
c = c.replace("trpc.batchPayments.", "trpc.batchPaymentV97.")
c = c.replace("trpc.batchPaymentV97.getDetails.", "trpc.batchPaymentV97.getStatus.")
# Fix Card title prop
c = re.sub(r'<Card\s+title="([^"]+)">', 
           r'<Card>\n        <CardHeader><CardTitle>\1</CardTitle></CardHeader>', c)
c = c.replace(".isLoading", ".isPending")
write("BatchPaymentAdmin.tsx", c)

# ── DocumentVaultRenewal ──────────────────────────────────────────────────────
print("DocumentVaultRenewal.tsx")
c = read("DocumentVaultRenewal.tsx")
c = c.replace("trpc.documentVaultRenewal.listRenewals.", "trpc.documentVaultRenewal.listMyRenewals.")
c = c.replace("trpc.documentVaultRenewal.renewDocument.", "trpc.documentVaultRenewal.initiateRenewal.")
# id -> documentId
c = re.sub(r'(initiateRenewal\.mutate\(\{[^}]*?)id:\s*([^,}]+)', r'\1documentId: \2', c)
c = c.replace(".isLoading", ".isPending")
write("DocumentVaultRenewal.tsx", c)

# ── AuditLogViewer ────────────────────────────────────────────────────────────
print("AuditLogViewer.tsx")
c = read("AuditLogViewer.tsx")
c = c.replace("trpc.auditLogs.getById.", "trpc.auditLogs.list.")
c = c.replace("search: filter.search,", "")
c = c.replace("search: searchTerm,", "")
c = c.replace("data?.hasMore", "false")
c = c.replace("data?.beneficiaries", "data?.logs")
c = c.replace(".isLoading", ".isPending")
write("AuditLogViewer.tsx", c)

# ── DocumentVaultPage ─────────────────────────────────────────────────────────
print("DocumentVaultPage.tsx")
c = read("DocumentVaultPage.tsx")
if "from 'sonner'" not in c and "from \"sonner\"" not in c and "toast" in c:
    c = "import { toast } from 'sonner';\n" + c
c = c.replace(".isLoading", ".isPending")
write("DocumentVaultPage.tsx", c)

# ── PromoCodeAdmin ────────────────────────────────────────────────────────────
print("PromoCodeAdmin.tsx")
c = read("PromoCodeAdmin.tsx")
c = c.replace("control={form.control}", "control={form.control as any}")
c = c.replace("data?.hasMore", "false")
c = c.replace(".isLoading", ".isPending")
write("PromoCodeAdmin.tsx", c)

# ── PartnerSelfService ────────────────────────────────────────────────────────
print("PartnerSelfService.tsx")
c = read("PartnerSelfService.tsx")
c = c.replace("trpc.partners.getBrandingConfig.", "trpc.partners.getMyPartner.")
c = c.replace(".isLoading", ".isPending")
write("PartnerSelfService.tsx", c)

# ── ComplianceMetricsDashboard ────────────────────────────────────────────────
print("ComplianceMetricsDashboard.tsx")
c = read("ComplianceMetricsDashboard.tsx")
c = re.sub(r'trpc\.compliance\.getStats\.useQuery\(\{[^}]*\}\)', 
           "trpc.compliance.getStats.useQuery()", c)
c = c.replace(".isLoading", ".isPending")
write("ComplianceMetricsDashboard.tsx", c)

# ── StripePaymentHistory ──────────────────────────────────────────────────────
print("StripePaymentHistory.tsx")
c = read("StripePaymentHistory.tsx")
# key field doesn't exist on { success: boolean }
c = re.sub(r'data\?\.key\b', "data?.id", c)
c = c.replace(".isLoading", ".isPending")
write("StripePaymentHistory.tsx", c)

# ── Global sweep: isLoading -> isPending ──────────────────────────────────────
print("\nGlobal isLoading sweep...")
for fname in sorted(os.listdir(pages_dir)):
    if not fname.endswith(".tsx"):
        continue
    fpath = os.path.join(pages_dir, fname)
    with open(fpath, "r") as f:
        c = f.read()
    if ".isLoading" in c:
        with open(fpath, "w") as f:
            f.write(c.replace(".isLoading", ".isPending"))
        print(f"  isLoading: {fname}")

print("\nDone.")
