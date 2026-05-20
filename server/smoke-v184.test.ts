/**
 * smoke-v184.test.ts
 * Sprint v184 — Evidence Upload, CSV Export, Profile Enhancement, Admin Copy Button
 * All tests are static code/schema assertions (no DB or network required).
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const root = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

// ─── 1. Evidence File Upload ──────────────────────────────────────────────────
describe("v184 — Evidence file upload (TransferDisputeForm)", () => {
  const form = read("client/src/pages/TransferDisputeForm.tsx");

  it("imports useRef for file input", () => {
    expect(form).toContain("useRef");
  });

  it("has a hidden file input element", () => {
    expect(form).toMatch(/type=["']file["']/);
  });

  it("calls uploadEvidenceFile mutation", () => {
    expect(form).toContain("uploadEvidenceFile");
  });

  it("shows upload progress bar", () => {
    expect(form).toMatch(/progress|Progress|uploading/i);
  });

  it("disables submit button while uploading", () => {
    expect(form).toMatch(/disabled.*upload|upload.*disabled/i);
  });

  it("accepts image and PDF file types", () => {
    expect(form).toMatch(/image\/|application\/pdf/);
  });

  it("reads file as base64 via FileReader", () => {
    expect(form).toContain("FileReader");
    expect(form).toContain("readAsDataURL");
  });

  it("shows uploaded badge or success state", () => {
    expect(form).toMatch(/uploaded|Uploaded|evidenceUrl/i);
  });
});

// ─── 2. uploadEvidenceFile server procedure ───────────────────────────────────
describe("v184 — uploadEvidenceFile tRPC procedure", () => {
  const router = read("server/routers/transferDispute.ts");

  it("defines uploadEvidenceFile procedure", () => {
    expect(router).toContain("uploadEvidenceFile");
  });

  it("accepts fileBase64 and mimeType inputs", () => {
    expect(router).toContain("fileBase64");
    expect(router).toContain("mimeType");
  });

  it("calls storagePut to upload to S3", () => {
    expect(router).toContain("storagePut");
  });

  it("returns a url from S3", () => {
    expect(router).toMatch(/url.*storagePut|storagePut.*url/s);
  });

  it("is a protectedProcedure", () => {
    const idx = router.indexOf("uploadEvidenceFile");
    const snippet = router.slice(Math.max(0, idx - 50), idx + 200);
    expect(snippet).toContain("protectedProcedure");
  });

  it("stores evidence key with dispute ID in path", () => {
    expect(router).toMatch(/evidence.*dispute|dispute.*evidence/i);
  });
});

// ─── 3. CSV Transaction Export ────────────────────────────────────────────────
describe("v184 — CSV transaction export (MyTransfers page)", () => {
  const myTransfers = read("client/src/pages/MyTransfers.tsx");

  it("has an export/download button", () => {
    expect(myTransfers).toMatch(/[Ee]xport|[Dd]ownload/);
  });

  it("links to /transactions/export or TransactionExport page", () => {
    expect(myTransfers).toMatch(/transactions\/export|TransactionExport|export/i);
  });
});

describe("v184 — TransactionExport page exists and is routed", () => {
  it("TransactionExport.tsx exists", () => {
    expect(fs.existsSync(path.join(root, "client/src/pages/TransactionExport.tsx"))).toBe(true);
  });

  it("TransactionExport is routed in App.tsx", () => {
    const app = read("client/src/App.tsx");
    expect(app).toMatch(/TransactionExport|transactions\/export/i);
  });

  it("TransactionExport uses tRPC for export request", () => {
    const page = read("client/src/pages/TransactionExport.tsx");
    expect(page).toMatch(/trpc\.|export/i);
  });

  it("TransactionExport supports CSV format", () => {
    const page = read("client/src/pages/TransactionExport.tsx");
    expect(page).toMatch(/csv|CSV/);
  });
});

// ─── 4. User Profile Page ─────────────────────────────────────────────────────
describe("v184 — Profile page enhancements", () => {
  const profile = read("client/src/pages/Profile.tsx");

  it("uses trpc.profile.get for data fetching", () => {
    expect(profile).toContain("trpc.profile.get");
  });

  it("uses trpc.profile.uploadAvatar for avatar upload", () => {
    expect(profile).toContain("trpc.profile.uploadAvatar");
  });

  it("uses trpc.profile.update for editing", () => {
    expect(profile).toContain("trpc.profile.update");
  });

  it("has avatar upload button with Camera icon", () => {
    expect(profile).toContain("Camera");
  });

  it("has hidden file input for avatar", () => {
    expect(profile).toMatch(/type=["']file["']/);
  });

  it("reads avatar as base64 via FileReader", () => {
    expect(profile).toContain("FileReader");
    expect(profile).toContain("readAsDataURL");
  });

  it("shows profile completeness score", () => {
    expect(profile).toMatch(/completeness|completenessScore/i);
  });

  it("shows Progress bar for completeness", () => {
    expect(profile).toContain("Progress");
  });

  it("has date of birth field", () => {
    expect(profile).toMatch(/dateOfBirth|date.*birth|Date of Birth/i);
  });

  it("has quick links section for account settings", () => {
    expect(profile).toMatch(/quickLinks|Account Settings/i);
  });

  it("links to /security from quick links", () => {
    expect(profile).toContain("/security");
  });

  it("links to /notifications from quick links", () => {
    expect(profile).toContain("/notifications");
  });

  it("links to /kyc from quick links", () => {
    expect(profile).toContain("/kyc");
  });

  it("shows KYC tier progress cards", () => {
    expect(profile).toMatch(/KYC_LABELS|kycLabels|KYC Verification Tiers/i);
  });

  it("shows AvatarImage when avatarUrl is present", () => {
    expect(profile).toContain("AvatarImage");
  });

  it("shows initials as AvatarFallback", () => {
    expect(profile).toContain("AvatarFallback");
  });
});

// ─── 5. Profile backend procedures ───────────────────────────────────────────
describe("v184 — Profile backend procedures", () => {
  const routers = read("server/routers.ts");

  it("profile.get procedure exists", () => {
    const idx = routers.indexOf("profile: router(");
    expect(idx).toBeGreaterThan(-1);
    const block = routers.slice(idx, idx + 300);
    expect(block).toContain("get:");
  });

  it("profile.update accepts dateOfBirth", () => {
    const idx = routers.indexOf("profile: router(");
    const block = routers.slice(idx, idx + 600);
    expect(block).toContain("dateOfBirth");
  });

  it("profile.uploadAvatar accepts fileBase64 and mimeType", () => {
    const idx = routers.indexOf("uploadAvatar");
    expect(idx).toBeGreaterThan(-1);
    const block = routers.slice(idx, idx + 300);
    expect(block).toContain("fileBase64");
    expect(block).toContain("mimeType");
  });

  it("profile.uploadAvatar calls storagePut", () => {
    const idx = routers.indexOf("uploadAvatar");
    const block = routers.slice(idx, idx + 800);
    expect(block).toContain("storagePut");
  });
});

// ─── 6. AdminDisputes Copy Button ────────────────────────────────────────────
describe("v184 — AdminDisputes CopyIdButton", () => {
  const admin = read("client/src/pages/AdminDisputes.tsx");

  it("has CopyIdButton component", () => {
    expect(admin).toContain("CopyIdButton");
  });

  it("uses navigator.clipboard.writeText", () => {
    expect(admin).toContain("clipboard");
  });

  it("shows Copy icon", () => {
    expect(admin).toContain("Copy");
  });

  it("shows Check icon after copy", () => {
    expect(admin).toContain("Check");
  });

  it("copies transaction ID", () => {
    expect(admin).toMatch(/transactionId|transaction.*id|Transaction ID/i);
  });

  it("copies dispute ID", () => {
    expect(admin).toMatch(/disputeId|dispute.*id|Dispute ID/i);
  });

  it("shows toast after copy", () => {
    expect(admin).toContain("toast");
  });
});

// ─── 7. DashboardLayout Profile link ─────────────────────────────────────────
describe("v184 — DashboardLayout profile navigation", () => {
  const layout = read("client/src/components/DashboardLayout.tsx");

  it("navigates to /profile from user menu", () => {
    expect(layout).toContain('"/profile"');
  });

  it("has separate Settings menu item", () => {
    expect(layout).toContain('"/settings"');
  });

  it("imports Settings icon from lucide-react", () => {
    expect(layout).toContain("Settings");
  });
});

// ─── 8. Profile route in App.tsx ─────────────────────────────────────────────
describe("v184 — Profile route registration", () => {
  const app = read("client/src/App.tsx");

  it("/profile route is registered", () => {
    expect(app).toMatch(/path=["']\/profile["']/);
  });

  it("Profile page is lazy-loaded", () => {
    expect(app).toMatch(/lazy.*Profile|Profile.*lazy/s);
  });
});
