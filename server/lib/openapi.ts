/**
 * OpenAPI/Swagger documentation generator — P1 DX 8.2
 * Auto-generates OpenAPI 3.1 spec from tRPC router definitions.
 */
import { z } from "zod";

interface OpenApiEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  summary: string;
  description?: string;
  tags: string[];
  requestSchema?: z.ZodTypeAny;
  responseSchema?: z.ZodTypeAny;
  auth: boolean;
  rateLimit?: { max: number; windowMs: number };
}

const ENDPOINTS: OpenApiEndpoint[] = [];

export function registerEndpoint(endpoint: OpenApiEndpoint): void {
  ENDPOINTS.push(endpoint);
}

export function generateOpenApiSpec(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const ep of ENDPOINTS) {
    if (!paths[ep.path]) paths[ep.path] = {};

    const operation: Record<string, unknown> = {
      summary: ep.summary,
      description: ep.description,
      tags: ep.tags,
      operationId: ep.path.replace(/\//g, "_").replace(/^_/, ""),
      responses: {
        "200": { description: "Success" },
        "400": { description: "Bad Request", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } } },
        "401": { description: "Unauthorized" },
        "403": { description: "Forbidden" },
        "429": { description: "Too Many Requests" },
        "500": { description: "Internal Server Error" },
      },
    };

    if (ep.auth) {
      operation.security = [{ bearerAuth: [] }, { cookieAuth: [] }];
    }

    paths[ep.path][ep.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "RemitFlow API",
      version: "2.0.0",
      description:
        "RemitFlow — Africa-focused remittance platform API. Supports 50+ corridors, " +
        "multi-currency wallets, KYC/KYB verification, real-time FX rates, and payment processing.",
      contact: { name: "RemitFlow Support", email: "api@remitflow.io" },
      license: { name: "Proprietary" },
    },
    servers: [
      { url: "https://api.remitflow.io", description: "Production" },
      { url: "https://staging-api.remitflow.io", description: "Staging" },
      { url: "http://localhost:5000", description: "Local Development" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "remitflow_session" },
        apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
      },
      schemas: {
        ApiError: {
          type: "object",
          properties: {
            code: { type: "string", description: "Machine-readable error code" },
            message: { type: "string", description: "Human-readable error message" },
            details: { type: "object", additionalProperties: true },
            requestId: { type: "string" },
            timestamp: { type: "string", format: "date-time" },
          },
          required: ["code", "message", "timestamp"],
        },
        Transfer: {
          type: "object",
          properties: {
            id: { type: "integer" },
            userId: { type: "integer" },
            beneficiaryId: { type: "integer" },
            amount: { type: "number", minimum: 0, exclusiveMinimum: true },
            currency: { type: "string", pattern: "^[A-Z]{3}$" },
            targetCurrency: { type: "string", pattern: "^[A-Z]{3}$" },
            fxRate: { type: "number" },
            fee: { type: "number" },
            status: { type: "string", enum: ["pending", "processing", "completed", "failed", "cancelled", "refunded"] },
            createdAt: { type: "string", format: "date-time" },
            completedAt: { type: "string", format: "date-time", nullable: true },
          },
        },
        Wallet: {
          type: "object",
          properties: {
            id: { type: "integer" },
            userId: { type: "integer" },
            currency: { type: "string" },
            balance: { type: "number" },
            isDefault: { type: "boolean" },
          },
        },
        Beneficiary: {
          type: "object",
          properties: {
            id: { type: "integer" },
            userId: { type: "integer" },
            name: { type: "string" },
            country: { type: "string" },
            bankName: { type: "string" },
            accountNumber: { type: "string" },
            currency: { type: "string" },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Authentication and session management" },
      { name: "Transfer", description: "Money transfer operations" },
      { name: "Wallet", description: "Multi-currency wallet management" },
      { name: "FX", description: "Foreign exchange rates and conversion" },
      { name: "Beneficiary", description: "Recipient management" },
      { name: "KYC", description: "Know Your Customer verification" },
      { name: "Compliance", description: "AML/CFT compliance and reporting" },
      { name: "Admin", description: "Administrative operations" },
      { name: "Notifications", description: "User notification management" },
      { name: "Analytics", description: "Transaction analytics and reporting" },
    ],
  };
}

registerEndpoint({ path: "/api/trpc/auth.login", method: "POST", summary: "Login with credentials", tags: ["Auth"], auth: false, rateLimit: { max: 5, windowMs: 60000 } });
registerEndpoint({ path: "/api/trpc/auth.register", method: "POST", summary: "Create new account", tags: ["Auth"], auth: false, rateLimit: { max: 3, windowMs: 300000 } });
registerEndpoint({ path: "/api/trpc/auth.me", method: "GET", summary: "Get current user", tags: ["Auth"], auth: true });
registerEndpoint({ path: "/api/trpc/transfer.send", method: "POST", summary: "Initiate money transfer", tags: ["Transfer"], auth: true });
registerEndpoint({ path: "/api/trpc/transfer.list", method: "GET", summary: "List user transfers", tags: ["Transfer"], auth: true });
registerEndpoint({ path: "/api/trpc/wallet.list", method: "GET", summary: "List user wallets", tags: ["Wallet"], auth: true });
registerEndpoint({ path: "/api/trpc/wallet.balance", method: "GET", summary: "Get wallet balance", tags: ["Wallet"], auth: true });
registerEndpoint({ path: "/api/trpc/fx.rates", method: "GET", summary: "Get live FX rates", tags: ["FX"], auth: false });
registerEndpoint({ path: "/api/trpc/fx.convert", method: "POST", summary: "Convert currency", tags: ["FX"], auth: true });
registerEndpoint({ path: "/api/trpc/beneficiaries.list", method: "GET", summary: "List beneficiaries", tags: ["Beneficiary"], auth: true });
registerEndpoint({ path: "/api/trpc/beneficiaries.create", method: "POST", summary: "Add beneficiary", tags: ["Beneficiary"], auth: true });
registerEndpoint({ path: "/api/trpc/kyc.status", method: "GET", summary: "Get KYC verification status", tags: ["KYC"], auth: true });
registerEndpoint({ path: "/api/trpc/kyc.submit", method: "POST", summary: "Submit KYC documents", tags: ["KYC"], auth: true });
registerEndpoint({ path: "/api/trpc/notifications.list", method: "GET", summary: "List notifications", tags: ["Notifications"], auth: true });
registerEndpoint({ path: "/api/trpc/analytics.summary", method: "GET", summary: "Get analytics summary", tags: ["Analytics"], auth: true });
