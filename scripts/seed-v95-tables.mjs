/**
 * seed-v95-tables.mjs
 * Seeds fraud_alerts, security_events, beneficiaries (top-up to 50),
 * exchange_rate_alerts, compliance_alerts, sanctions_checks.
 * Run: node scripts/seed-v95-tables.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.LOCAL_DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // ── fraud_alerts (need 20+) ────────────────────────────────────────────
    const fraudEnums = await client.query(
      "SELECT unnest(enum_range(NULL::fraud_risk_level))::text AS v"
    );
    const riskLevels = fraudEnums.rows.map((r) => r.v);
    const fraudStatusEnums = await client.query(
      "SELECT unnest(enum_range(NULL::fraud_alert_status))::text AS v"
    );
    const fraudStatuses = fraudStatusEnums.rows.map((r) => r.v);

    console.log("Risk levels:", riskLevels);
    console.log("Fraud statuses:", fraudStatuses);

    for (let i = 1; i <= 25; i++) {
      const riskLevel = riskLevels[i % riskLevels.length];
      const status = fraudStatuses[i % fraudStatuses.length];
      const riskScore = 30 + (i % 70);
      await client.query(
        `INSERT INTO fraud_alerts (user_id, transaction_id, risk_score, risk_level, status, flagged_reasons, transaction_amount, created_at, updated_at)
         VALUES ($1, $2, $3, $4::fraud_risk_level, $5::fraud_alert_status, $6, $7, NOW() - INTERVAL '${i} days', NOW())
         ON CONFLICT DO NOTHING`,
        [
          (i % 2) + 1,
          i,
          riskScore,
          riskLevel,
          status,
          JSON.stringify([`velocity_check_${i}`, `amount_threshold`]),
          i * 500 + 1000,
        ]
      );
    }
    console.log("✓ fraud_alerts seeded (25 rows)");

    // ── security_events (need 100+) ────────────────────────────────────────
    const eventTypes = [
      "login_success",
      "login_failure",
      "password_change",
      "mfa_enabled",
      "suspicious_ip",
      "rate_limit_hit",
      "session_expired",
      "api_key_created",
      "admin_action",
      "kyc_submitted",
    ];
    const severities = ["low", "medium", "high", "critical"];
    const ips = [
      "102.89.23.1",
      "41.58.100.2",
      "197.210.64.3",
      "196.207.1.4",
      "105.113.22.5",
    ];

    for (let i = 1; i <= 110; i++) {
      await client.query(
        `INSERT INTO security_events (user_id, event_type, severity, ip_address, user_agent, location, details, resolved, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '${i} hours')
         ON CONFLICT DO NOTHING`,
        [
          (i % 2) + 1,
          eventTypes[i % eventTypes.length],
          severities[i % severities.length],
          ips[i % ips.length],
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
          "Lagos, Nigeria",
          `Security event ${i}: ${eventTypes[i % eventTypes.length]}`,
          i % 3 === 0,
        ]
      );
    }
    console.log("✓ security_events seeded (110 rows)");

    // ── beneficiaries (top up to 50) ───────────────────────────────────────
    const currentCount = await client.query(
      "SELECT COUNT(*) FROM beneficiaries"
    );
    const existing = Number(currentCount.rows[0].count);
    const needed = Math.max(0, 50 - existing);
    const banks = [
      "First Bank",
      "GTBank",
      "Access Bank",
      "Zenith Bank",
      "UBA",
    ];
    const countries = ["NG", "GH", "KE", "TG", "SN"];
    const currencies = ["NGN", "GHS", "KES", "XOF", "USD"];

    for (let i = 1; i <= needed; i++) {
      await client.query(
        `INSERT INTO beneficiaries ("userId", name, "accountNumber", "bankName", "bankCode", currency, country, phone, email)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT DO NOTHING`,
        [
          (i % 2) + 1,
          `Beneficiary ${existing + i}`,
          `00${String(i).padStart(8, "0")}`,
          banks[i % banks.length],
          `00${i}`,
          currencies[i % currencies.length],
          countries[i % countries.length],
          `+234${String(800000000 + i)}`,
          `beneficiary${existing + i}@example.com`,
        ]
      );
    }
    console.log(`✓ beneficiaries seeded (added ${needed} rows, total 50+)`);

    // ── exchange_rate_alerts (need 30+) ────────────────────────────────────
    const erAlertCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='exchange_rate_alerts' ORDER BY ordinal_position"
    );
    console.log(
      "exchange_rate_alerts cols:",
      erAlertCols.rows.map((r) => r.column_name)
    );

    const pairs = [
      ["USD", "NGN"],
      ["USD", "GHS"],
      ["USD", "KES"],
      ["EUR", "NGN"],
      ["GBP", "NGN"],
      ["USD", "XOF"],
    ];
    for (let i = 1; i <= 35; i++) {
      const pair = pairs[i % pairs.length];
      await client.query(
        `INSERT INTO exchange_rate_alerts (user_id, from_currency, to_currency, target_rate, direction, is_active, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${i} days')
         ON CONFLICT DO NOTHING`,
        [
          (i % 2) + 1,
          pair[0],
          pair[1],
          (1500 + i * 10).toFixed(4),
          i % 2 === 0 ? "above" : "below",
          true,
        ]
      );
    }
    console.log("✓ exchange_rate_alerts seeded (35 rows)");

    // ── compliance_alerts (need 50+) ───────────────────────────────────────
    const compCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='compliance_alerts' ORDER BY ordinal_position"
    );
    console.log(
      "compliance_alerts cols:",
      compCols.rows.map((r) => r.column_name)
    );

    const alertTypes = [
      "aml_flag",
      "kyc_expiry",
      "transaction_limit",
      "sanctions_match",
      "pep_match",
    ];
    const alertSeverities = ["low", "medium", "high", "critical"];
    for (let i = 1; i <= 55; i++) {
      await client.query(
        `INSERT INTO compliance_alerts (alert_type, severity, title, description, related_user_id, status, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${i} hours')
         ON CONFLICT DO NOTHING`,
        [
          alertTypes[i % alertTypes.length],
          alertSeverities[i % alertSeverities.length],
          `${alertTypes[i % alertTypes.length].replace(/_/g, ' ').toUpperCase()} Alert`,
          `Compliance alert ${i}: ${alertTypes[i % alertTypes.length]}`,
          (i % 2) + 1,
          i % 4 === 0 ? 'resolved' : 'open',
        ]
      );
    }
    console.log("✓ compliance_alerts seeded (55 rows)");

    // ── sanctions_checks (need 30+) ────────────────────────────────────────
    const sanctCols = await client.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='sanctions_checks' ORDER BY ordinal_position"
    );
    console.log(
      "sanctions_checks cols:",
      sanctCols.rows.map((r) => r.column_name)
    );

    const sanctStatuses = ["clear", "match", "pending", "review"];
    for (let i = 1; i <= 35; i++) {
      await client.query(
        `INSERT INTO sanctions_checks (screening_id, user_id, entity_name, entity_type, result, risk_level, lists_checked, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, ARRAY['OFAC','UN','EU'], NOW() - INTERVAL '${i} hours')
         ON CONFLICT DO NOTHING`,
        [
          `SCR-${Date.now()}-${i}`,
          (i % 2) + 1,
          `Entity Name ${i}`,
          i % 2 === 0 ? 'individual' : 'organization',
          i % 3 === 0 ? 'hit' : (i % 5 === 0 ? 'pending_review' : 'clear'),
          sanctStatuses[i % sanctStatuses.length],
        ]
      );
    }
    console.log("✓ sanctions_checks seeded (35 rows)");

    console.log("\n✅ All v95 tables seeded successfully!");
  } catch (err) {
    console.error("Seed error:", err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
