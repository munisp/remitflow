/**
 * BDC router barrel — namespaces the BDC bounded-context routers under `bdc.*`.
 * B1 operator + rates; B2 sales + sourcing; B3 vault + compliance + reporting;
 * B4 imto. Assembled by the orchestrator at integration.
 */
import { router } from "../../_core/trpc";
import { operatorRouter } from "./operator";
import { ratesRouter } from "./rates";
import { bdcSalesRouter } from "./sales";
import { bdcSourcingRouter } from "./sourcing";
import { bdcVaultRouter } from "./vault";
import { bdcComplianceRouter } from "./compliance";
import { bdcReportingRouter } from "./reporting";
import { bdcImtoRouter } from "./imto";
// wave12 gap closures (SPEC-wave12 §4) — orchestrator registration
import { bdcReversalsRouter } from "./reversals";
import { bdcRescreeningRouter } from "./rescreening";
import { bdcOffboardingRouter } from "./offboarding";
import { bdcPickupRouter } from "./pickup";
import { bdcAnalyticsRouter } from "./analytics";

export const bdcRouter = router({
  operator: operatorRouter,
  rates: ratesRouter,
  sales: bdcSalesRouter,
  sourcing: bdcSourcingRouter,
  vault: bdcVaultRouter,
  compliance: bdcComplianceRouter,
  reporting: bdcReportingRouter,
  imto: bdcImtoRouter,
  reversals: bdcReversalsRouter,
  rescreening: bdcRescreeningRouter,
  offboarding: bdcOffboardingRouter,
  pickup: bdcPickupRouter,
  analytics: bdcAnalyticsRouter,
});
