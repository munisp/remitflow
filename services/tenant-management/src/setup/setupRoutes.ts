import { Application } from "express";
import healthCheckRoute from "../routes/healthCheckRoute";
import systemRoutes from "../routes/systemRoutes";
import tenantRoutes from "../routes/tenantRoutes";
import billingRoutes from "../routes/billingRoutes";
import { requiredHeaders } from "../middlewares/required_headers";
import { requireServiceAuth } from "../middlewares/auth";

export default function setupRoutes(app: Application): void {
  app.use("/health", healthCheckRoute);
  // SEC-31: tenant lifecycle, system and billing endpoints require a valid
  // service bearer token. Header presence alone is NOT authentication.
  app.use("/system", requireServiceAuth(), requiredHeaders(["x-tenant-id"]), systemRoutes);
  app.use("/tenant", requireServiceAuth(), tenantRoutes);
  app.use("/billing", requireServiceAuth(), requiredHeaders(["x-tenant-id"]), billingRoutes);
}
