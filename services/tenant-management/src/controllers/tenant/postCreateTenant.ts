import httpStatus from "http-status";
import { asyncHandler } from "../../middlewares/async";
import { PostCreateTenantSchema, validateRequest } from "../../validations";
import { tenantRepository } from "../../repositories/tenantRepository";
import { BillingPeriod, BillingPlan } from "../../utils/enums";
import logger from "../../config/logger.config";

export const postCreateTenant = asyncHandler(async (req, res) => {
  try {
    logger.info("[postCreateTenant] Received request", {
      body: req.body,
      tenantId: req.headers["x-tenant-id"],
    });

    const payload = validateRequest(PostCreateTenantSchema, req.body);
    const tenantId = req.headers["x-tenant-id"] as string;

    logger.info("[postCreateTenant] Validated payload", {
      tenantId,
      plan: payload?.plan,
    });

    const tenant = await tenantRepository.createTenant({ ...payload, tenantId });
    logger.info("[postCreateTenant] Tenant created successfully", {
      tenantId,
      tenantName: tenant?.name,
    });

    const plan = payload?.plan || BillingPlan.STANDARD;
    const billingPeriod = payload?.billingPeriod || BillingPeriod.MONTHLY;
    logger.info("[postCreateTenant] Creating billing profile", {
      tenantId,
      plan,
      billingPeriod,
    });

    // If this call fails, the tenant row above is already committed with no
    // compensation — recovery works via retry since createOrGetProfile (billing-service
    // side) is idempotent per tenantId, so a repeat PUT /billing call is safe.
    // When BILLING_SERVICE_URL isn't configured (no billing-service deployed
    // in this platform yet), billingService returns null instead of throwing,
    // so tenant provisioning itself never blocks on it.
    const billingProfile = await tenantRepository.createBillingProfile(tenantId, plan, billingPeriod);
    logger.info("[postCreateTenant] Billing profile step complete", {
      tenantId,
      billingProfileCreated: billingProfile !== null,
    });

    return res.status(httpStatus.CREATED).json({
      status: "success",
      tenant,
      billingProfile,
    });
  } catch (error: any) {
    logger.error("[postCreateTenant] Request failed", {
      tenantId: req.headers["x-tenant-id"],
      errorMessage: error?.message,
      errorCode: error?.code,
      errorStatus: error?.status,
      errorResponse: error?.response,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      stack: error?.stack,
    });
    throw error;
  }
});
