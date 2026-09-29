/**
 * Domain module: kyc — split out of the monolithic services/api.ts
 * (wave14). Re-exported through the services/api.ts barrel; import sites unchanged.
 */
import {
  api,
} from "./core";
import type {
  BVNVerification,
  KYCDocument,
  KYCLimits,
  KYCProfile,
  KYCUpgradeRequest,
} from "./types";

// KYC Service
export const kycService = {
  getProfile: () => api.get<KYCProfile>("/kyc/profile"),

  updateProfile: (data: Partial<KYCProfile>) =>
    api.put<KYCProfile>("/kyc/profile", data),

  uploadDocument: (type: string, file: File) => {
    const formData = new FormData();
    formData.append("type", type);
    formData.append("file", file);
    return api.post<KYCDocument>("/kyc/documents", formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  getDocuments: () => api.get<KYCDocument[]>("/kyc/documents"),

  verifyBvn: (bvn: string) =>
    api.post<BVNVerification>("/kyc/verify-bvn", { bvn }),

  getLimits: () => api.get<KYCLimits>("/kyc/limits"),

  requestTierUpgrade: (tier: string) =>
    api.post<KYCUpgradeRequest>("/kyc/upgrade", { tier }),
};
