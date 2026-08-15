import express from "express";
import cors from "cors";
import compression from "compression";
import setupRoutes from "./setup/setupRoutes";
import setupBeforeMiddlewares from "./setup/setupBeforeMiddlewares";
import setupAfterMiddlewares from "./setup/setupAfterMiddlewares";

const app = express();

// CORS origins are env-configured (comma-separated ALLOWED_ORIGINS).
// Never fall back to "*": in production a missing allowlist fails loudly;
// outside production we warn and disable cross-origin access entirely.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter((o) => o.length > 0);

const isProd =
  process.env.NODE_ENV === "production" || process.env.APP_ENV === "production";

if (allowedOrigins.length === 0) {
  if (isProd) {
    throw new Error(
      "[tenant-management] ALLOWED_ORIGINS is not set in production: refusing " +
        "to start with an unrestricted CORS policy.",
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    "[tenant-management] ALLOWED_ORIGINS is not set: cross-origin requests " +
      "will receive no CORS headers (same-origin only).",
  );
}

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  }),
);
app.use(express.json());

app.use(compression());
app.use(express.static("public"));

setupBeforeMiddlewares(app);
setupRoutes(app);
setupAfterMiddlewares(app);

export default app;
