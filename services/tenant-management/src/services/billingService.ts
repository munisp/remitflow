import { readEnv } from "../config/readEnv.config";
import { IGetBillingInfoResponse, IBillingProfile } from "../types/billing";
import logger from "../config/logger.config";

class BillingService {
  private BASE_URL: string = readEnv("BILLING_SERVICE_URL", "");

  get isConfigured(): boolean {
    return this.BASE_URL.length > 0;
  }

  async createBillingProfile(tenantId: string, plan: string, billingPeriod: string) {
    if (!this.isConfigured) {
      logger.warn("[BillingService] BILLING_SERVICE_URL not set — skipping billing profile creation", {
        tenantId,
      });
      return null;
    }

    try {
      logger.info("[BillingService] Creating billing profile", {
        tenantId,
        plan,
        billingPeriod,
        baseUrl: this.BASE_URL,
      });

      const res = await fetch(`${this.BASE_URL}/billing`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenantId,
        },
        body: JSON.stringify({ plan, billingPeriod }),
      });

      if (!res.ok) {
        throw new Error(`billing-service returned ${res.status}`);
      }

      const response = await res.json();

      logger.info("[BillingService] Billing profile created successfully", {
        tenantId,
        responseKeys: Object.keys(response || {}),
      });

      const { billing_profile } = response as { billing_profile: IBillingProfile };
      return billing_profile;
    } catch (error: any) {
      logger.error("[BillingService] Failed to create billing profile", {
        tenantId,
        plan,
        baseUrl: this.BASE_URL,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStatus: error?.status,
        errorResponse: error?.response,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        stack: error?.stack,
      });
      throw error;
    }
  }

  async getBillingInfo(tenantId: string) {
    if (!this.isConfigured) {
      throw new Error("BILLING_SERVICE_URL is not configured");
    }

    try {
      logger.info("[BillingService] Fetching billing info", {
        tenantId,
        baseUrl: this.BASE_URL,
      });

      const res = await fetch(`${this.BASE_URL}/billing/info`, {
        method: "GET",
        headers: {
          "x-tenant-id": tenantId,
        },
      });

      if (!res.ok) {
        throw new Error(`billing-service returned ${res.status}`);
      }

      const response = await res.json();

      logger.info("[BillingService] Billing info fetched successfully", {
        tenantId,
        responseKeys: Object.keys(response || {}),
      });

      const { billing_info } = response as { billing_info: IGetBillingInfoResponse };
      return billing_info;
    } catch (error: any) {
      logger.error("[BillingService] Failed to fetch billing info", {
        tenantId,
        baseUrl: this.BASE_URL,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStatus: error?.status,
        errorResponse: error?.response,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
        stack: error?.stack,
      });
      throw error;
    }
  }
}

export const billingService = new BillingService();
