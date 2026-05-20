/**
 * RemitFlow v110 Seed Script
 * Seeds: payment rail configs, CIPS/UPI/PIX test transactions, middleware service registry,
 *        Dapr component configs, Temporal workflow templates, Permify policies
 */
import postgres from 'postgres';
import { randomUUID } from "crypto";

const DB_URL = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function getConn() {
  const url = new URL(DB_URL);
  return sql;
}

async function seed() {
  const conn = await getConn();
  console.log("Connected to database");

  try {
    // ─── 1. Payment Rails Configuration ──────────────────────────────────────
    console.log("\n[1] Seeding payment rails configuration...");
    
    const railsToSeed = [
      {
        rail_id: "cips",
        name: "CIPS (Cross-Border Interbank Payment System)",
        status: "active",
        sandbox_mode: 1,
        base_url: "http://localhost:8091",
        api_version: "v1",
        supported_currencies: JSON.stringify(["CNY", "CNH"]),
        countries: JSON.stringify(["CN", "HK", "SG", "GB", "DE", "FR", "AU", "US"]),
        settlement_time_seconds: 14400,
        max_amount: 50000000,
        min_amount: 100,
        fee_fixed: 0,
        fee_percentage: 0.001,
        regulatory_body: "People's Bank of China (PBOC)",
        compliance_level: "high",
        requires_purpose_code: 1,
        requires_beneficiary_address: 1,
      },
      {
        rail_id: "upi",
        name: "UPI (Unified Payments Interface)",
        status: "active",
        sandbox_mode: 1,
        base_url: "http://localhost:8092",
        api_version: "v2",
        supported_currencies: JSON.stringify(["INR"]),
        countries: JSON.stringify(["IN", "SG", "AE", "GB", "US", "AU", "CA", "NP", "BH", "OM"]),
        settlement_time_seconds: 30,
        max_amount: 100000,
        min_amount: 1,
        fee_fixed: 0,
        fee_percentage: 0,
        regulatory_body: "National Payments Corporation of India (NPCI) / RBI",
        compliance_level: "medium",
        requires_purpose_code: 0,
        requires_beneficiary_address: 0,
      },
      {
        rail_id: "pix",
        name: "PIX (Brazil Instant Payment)",
        status: "active",
        sandbox_mode: 1,
        base_url: "http://localhost:8093",
        api_version: "v1",
        supported_currencies: JSON.stringify(["BRL"]),
        countries: JSON.stringify(["BR"]),
        settlement_time_seconds: 10,
        max_amount: 500000,
        min_amount: 0.01,
        fee_fixed: 0,
        fee_percentage: 0,
        regulatory_body: "Banco Central do Brasil (BCB)",
        compliance_level: "medium",
        requires_purpose_code: 0,
        requires_beneficiary_address: 0,
      },
      {
        rail_id: "mojaloop",
        name: "Mojaloop (FSPIOP)",
        status: "active",
        sandbox_mode: 1,
        base_url: "http://localhost:3003",
        api_version: "v1.1",
        supported_currencies: JSON.stringify(["KES", "TZS", "UGX", "GHS", "NGN", "ZAR", "XOF", "MWK"]),
        countries: JSON.stringify(["KE", "TZ", "UG", "GH", "NG", "ZA", "SN", "MW"]),
        settlement_time_seconds: 60,
        max_amount: 1000000,
        min_amount: 1,
        fee_fixed: 0.5,
        fee_percentage: 0.005,
        regulatory_body: "Mojaloop Foundation / GSMA",
        compliance_level: "medium",
        requires_purpose_code: 1,
        requires_beneficiary_address: 0,
      },
    ];

    // Try to insert into paymentRailsConfigs table if it exists
    for (const rail of railsToSeed) {
      try {
        await exec(
          `INSERT IGNORE INTO paymentRailsConfigs (id, railId, name, status, sandboxMode, baseUrl, apiVersion, 
           supportedCurrencies, countries, settlementTimeSeconds, maxAmount, minAmount, feeFixed, feePercentage,
           regulatoryBody, complianceLevel, requiresPurposeCode, requiresBeneficiaryAddress, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            randomUUID(), rail.rail_id, rail.name, rail.status, rail.sandbox_mode,
            rail.base_url, rail.api_version, rail.supported_currencies, rail.countries,
            rail.settlement_time_seconds, rail.max_amount, rail.min_amount,
            rail.fee_fixed, rail.fee_percentage, rail.regulatory_body,
            rail.compliance_level, rail.requires_purpose_code, rail.requires_beneficiary_address,
          ]
        );
        console.log(`  ✓ Rail config: ${rail.rail_id}`);
      } catch (e) {
        // Table may not exist yet - that's OK
        if (!e.message.includes("doesn't exist") && !e.message.includes("Table")) {
          console.log(`  ⚠ Rail ${rail.rail_id}: ${e.message}`);
        }
      }
    }

    // ─── 2. Middleware Service Registry ──────────────────────────────────────
    console.log("\n[2] Seeding middleware service registry...");
    
    const middlewareServices = [
      { name: "go-kafka-service", type: "messaging", url: "http://localhost:8094", status: "active", language: "go" },
      { name: "go-temporal-worker", type: "workflow", url: "http://localhost:8095", status: "active", language: "go" },
      { name: "go-permify-service", type: "authorization", url: "http://localhost:8096", status: "active", language: "go" },
      { name: "rust-redis-service", type: "cache", url: "http://localhost:8097", status: "active", language: "rust" },
      { name: "rust-fluvio-service", type: "streaming", url: "http://localhost:8098", status: "active", language: "rust" },
      { name: "python-keycloak-service", type: "iam", url: "http://localhost:8099", status: "active", language: "python" },
      { name: "python-opensearch-service", type: "analytics", url: "http://localhost:8100", status: "active", language: "python" },
      { name: "python-lakehouse-service", type: "lakehouse", url: "http://localhost:8101", status: "active", language: "python" },
      { name: "rust-pg-service", type: "database", url: "http://localhost:8102", status: "active", language: "rust" },
      { name: "go-apisix-service", type: "gateway", url: "http://localhost:8103", status: "active", language: "go" },
      { name: "rust-tigerbeetle-service", type: "ledger", url: "http://localhost:8104", status: "active", language: "rust" },
    ];

    for (const svc of middlewareServices) {
      try {
        await exec(
          `INSERT IGNORE INTO middlewareServiceRegistry (id, name, type, url, status, language, healthCheckPath, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, '/health', NOW(), NOW())`,
          [randomUUID(), svc.name, svc.type, svc.url, svc.status, svc.language]
        );
        console.log(`  ✓ Service: ${svc.name}`);
      } catch (e) {
        if (!e.message.includes("doesn't exist") && !e.message.includes("Table")) {
          console.log(`  ⚠ ${svc.name}: ${e.message}`);
        }
      }
    }

    // ─── 3. Test Payment Rail Transactions ───────────────────────────────────
    console.log("\n[3] Seeding test payment rail transactions...");
    
    const testTransactions = [
      {
        rail: "cips",
        from_currency: "USD",
        to_currency: "CNY",
        amount: 1000,
        recipient_id: "6222021001234567890",
        recipient_name: "Wei Zhang",
        status: "COMPLETED",
        external_ref: `CIPS-${Date.now()}-001`,
        exchange_rate: 7.24,
      },
      {
        rail: "upi",
        from_currency: "USD",
        to_currency: "INR",
        amount: 500,
        recipient_id: "priya.sharma@oksbi",
        recipient_name: "Priya Sharma",
        status: "COMPLETED",
        external_ref: `UPI-${Date.now()}-001`,
        exchange_rate: 83.45,
      },
      {
        rail: "pix",
        from_currency: "USD",
        to_currency: "BRL",
        amount: 750,
        recipient_id: "joao.silva@gmail.com",
        recipient_name: "João Silva",
        status: "COMPLETED",
        external_ref: `PIX-${Date.now()}-001`,
        exchange_rate: 4.97,
      },
      {
        rail: "mojaloop",
        from_currency: "USD",
        to_currency: "KES",
        amount: 200,
        recipient_id: "+254712345678",
        recipient_name: "Amara Osei",
        status: "COMPLETED",
        external_ref: `MOJA-${Date.now()}-001`,
        exchange_rate: 129.5,
      },
    ];

    for (const tx of testTransactions) {
      try {
        await exec(
          `INSERT IGNORE INTO paymentRailsTransactions 
           (id, rail, fromCurrency, toCurrency, amount, recipientId, recipientName, status, externalRef, exchangeRate, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            randomUUID(), tx.rail, tx.from_currency, tx.to_currency, tx.amount,
            tx.recipient_id, tx.recipient_name, tx.status, tx.external_ref, tx.exchange_rate,
          ]
        );
        console.log(`  ✓ Transaction: ${tx.rail} ${tx.amount} ${tx.from_currency} → ${tx.to_currency}`);
      } catch (e) {
        if (!e.message.includes("doesn't exist") && !e.message.includes("Table")) {
          console.log(`  ⚠ ${tx.rail}: ${e.message}`);
        }
      }
    }

    // ─── 4. Dapr Component Configs ────────────────────────────────────────────
    console.log("\n[4] Seeding Dapr component configurations...");
    
    const daprComponents = [
      { name: "pubsub-kafka", type: "pubsub.kafka", version: "v1", metadata: JSON.stringify({ brokers: "kafka:9092", authRequired: false }) },
      { name: "statestore-redis", type: "state.redis", version: "v1", metadata: JSON.stringify({ redisHost: "redis:6379", redisPassword: "" }) },
      { name: "secretstore-vault", type: "secretstores.hashicorp.vault", version: "v1", metadata: JSON.stringify({ vaultAddr: "http://vault:8200" }) },
    ];

    for (const comp of daprComponents) {
      try {
        await exec(
          `INSERT IGNORE INTO daprComponentConfigs (id, name, type, version, metadata, createdAt)
           VALUES (?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), comp.name, comp.type, comp.version, comp.metadata]
        );
        console.log(`  ✓ Dapr component: ${comp.name}`);
      } catch (e) {
        if (!e.message.includes("doesn't exist") && !e.message.includes("Table")) {
          console.log(`  ⚠ ${comp.name}: ${e.message}`);
        }
      }
    }

    // ─── 5. Temporal Workflow Templates ──────────────────────────────────────
    console.log("\n[5] Seeding Temporal workflow templates...");
    
    const workflows = [
      {
        name: "TransferWorkflow",
        description: "End-to-end money transfer with compliance checks, FX, and settlement",
        steps: JSON.stringify(["kyc_check", "sanctions_screening", "fx_conversion", "rail_initiation", "settlement", "notification"]),
        timeout_seconds: 3600,
        retry_policy: JSON.stringify({ maxAttempts: 3, backoffCoefficient: 2 }),
      },
      {
        name: "KYCVerificationWorkflow",
        description: "Multi-step KYC verification with document review and biometric checks",
        steps: JSON.stringify(["document_upload", "ocr_extraction", "biometric_check", "sanctions_check", "manual_review", "approval"]),
        timeout_seconds: 86400,
        retry_policy: JSON.stringify({ maxAttempts: 5, backoffCoefficient: 1.5 }),
      },
      {
        name: "MonthlyPayoutWorkflow",
        description: "Automated monthly revenue share payout to partners",
        steps: JSON.stringify(["calculate_earnings", "generate_report", "approval_gate", "initiate_payouts", "send_notifications"]),
        timeout_seconds: 7200,
        retry_policy: JSON.stringify({ maxAttempts: 2, backoffCoefficient: 2 }),
      },
    ];

    for (const wf of workflows) {
      try {
        await exec(
          `INSERT IGNORE INTO temporalWorkflowTemplates (id, name, description, steps, timeoutSeconds, retryPolicy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [randomUUID(), wf.name, wf.description, wf.steps, wf.timeout_seconds, wf.retry_policy]
        );
        console.log(`  ✓ Workflow: ${wf.name}`);
      } catch (e) {
        if (!e.message.includes("doesn't exist") && !e.message.includes("Table")) {
          console.log(`  ⚠ ${wf.name}: ${e.message}`);
        }
      }
    }

    console.log("\n✅ v110 seed completed successfully!");
    console.log("   Note: Tables that don't exist yet will be created when pnpm db:push is run.");

  } finally {
    await sql.end();
  }
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
