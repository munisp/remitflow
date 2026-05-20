#!/usr/bin/env node
/**
 * RemitFlow v100 — Live Database Seed Script (final, correct enum values)
 * Inserts 500+ demo records across 14 entity types into the live PostgreSQL DB.
 * Run: node scripts/seed-v100-db.mjs
 */
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL,
  ssl: process.env.LOCAL_DATABASE_URL ? false : { rejectUnauthorized: false },
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } catch (err) {
    if (err.code === "23505") return { rowCount: 0 };
    if (err.code === "23503") return { rowCount: 0 };
    console.warn("  ⚠️  SQL:", err.message.slice(0, 100));
    return { rowCount: 0 };
  } finally {
    client.release();
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rndFloat(min, max, dp = 2) { return parseFloat((Math.random() * (max - min) + min).toFixed(dp)); }

const CURRENCIES = ["USD","EUR","GBP","NGN","KES","GHS","ZAR","TZS","UGX","XOF","AED","CAD","AUD"];
const PROVIDERS  = ["JP Morgan","Citibank","Standard Chartered","Barclays","HSBC","Deutsche Bank","BNP Paribas"];
const BANKS      = ["Barclays","HSBC","Lloyds","NatWest","Santander","Halifax","Monzo","Starling","Revolut"];
const BANK_IDS   = ["barclays","hsbc","lloyds","natwest","santander","halifax","monzo","starling","revolut"];
const COUNTRIES  = ["Nigeria","Ghana","Kenya","Tanzania","Uganda","Senegal","South Africa","UK","USA","Germany"];

let total = 0;
const summary = {};

async function run(label, count, fn) {
  console.log(`\n→ ${label} (${count} records)...`);
  let n = 0;
  for (let i = 0; i < count; i++) { const r = await fn(i); n += r?.rowCount || 0; }
  summary[label] = n;
  total += n;
  console.log(`   ✓ Inserted ${n}`);
}

// ── 1. treasury_positions ────────────────────────────────────────────────────
async function seedTreasury() {
  const items = [...CURRENCIES, ...Array.from({length:37},()=>pick(CURRENCIES))];
  await run("treasury_positions", items.length, async (i) => {
    const ccy = items[i], bal = rndFloat(10000,5000000), lock = rndFloat(500,bal*0.15), avail = parseFloat((bal-lock).toFixed(2));
    return q(`INSERT INTO treasury_positions (currency,balance,locked_balance,available_balance,usd_equivalent,provider,account_ref,"updatedAt","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
      [ccy, bal, lock, avail, rndFloat(avail*0.001,avail*1.5), pick(PROVIDERS), `ACC-${ccy}-${rnd(10000,99999)}`]);
  });
}

// ── 2. open_banking_consents ─────────────────────────────────────────────────
async function seedOpenBanking() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  // Enum: awaiting_authorisation, authorised, rejected, revoked, expired
  const statuses = ["authorised","authorised","authorised","revoked","expired","awaiting_authorisation"];
  const permSets = [["ReadAccountsBasic","ReadBalances"],["ReadAccountsBasic","ReadTransactions"],["ReadAccountsDetail","ReadBalances","ReadTransactions"]];
  await run("open_banking_consents", 50, async (i) => {
    const bi = rnd(0,BANKS.length-1);
    return q(`INSERT INTO open_banking_consents (consent_id,user_id,bank_id,bank_name,status,permissions,expires_at,authorised_at,created_at) VALUES ($1,$2,$3,$4,$5::open_banking_consent_status,$6,NOW()+INTERVAL '90 days',NOW()-INTERVAL '${rnd(1,30)} days',NOW()-INTERVAL '${rnd(1,60)} days') ON CONFLICT DO NOTHING`,
      [`consent-${Date.now()}-${i}-${rnd(1000,9999)}`, pick(uids), BANK_IDS[bi], BANKS[bi], pick(statuses), pick(permSets)]);
  });
}

// ── 3. fraud_alerts ──────────────────────────────────────────────────────────
async function seedFraudAlerts() {
  const { rows: ur } = await q("SELECT id FROM users LIMIT 50");
  const { rows: tr } = await q("SELECT id FROM transactions LIMIT 100");
  const uids = ur.map(r=>r.id), tids = tr.map(r=>r.id);
  if (!uids.length) return;
  // Enums: fraud_risk_level: low,medium,high,critical | fraud_alert_status: pending,reviewed,blocked,cleared
  const levels = ["low","medium","high","critical"];
  const statuses = ["pending","reviewed","blocked","cleared"];
  const reasons = [["velocity_breach"],["geo_anomaly","device_fingerprint"],["amount_spike"],["beneficiary_mismatch","login_anomaly"],["card_testing"]];
  await run("fraud_alerts", 50, async () => {
    return q(`INSERT INTO fraud_alerts (user_id,transaction_id,risk_score,risk_level,status,flagged_reasons,transaction_amount,created_at,updated_at) VALUES ($1,$2,$3,$4::fraud_risk_level,$5::fraud_alert_status,$6,$7,NOW()-INTERVAL '${rnd(1,90)} days',NOW()-INTERVAL '${rnd(0,10)} days') ON CONFLICT DO NOTHING`,
      [pick(uids), tids.length?pick(tids):null, rnd(10,100), pick(levels), pick(statuses), JSON.stringify(pick(reasons)), rnd(5000,500000)]);
  });
}

// ── 4. fee_rules ─────────────────────────────────────────────────────────────
async function seedFeeRules() {
  // Actual schema: corridor,min_amount,max_amount,fee_type,fee_percentage,fee_fixed,min_fee,max_fee,is_active
  const corridors = ["USD-NGN","GBP-NGN","EUR-GHS","USD-KES","GBP-GHS","CAD-NGN","AUD-NGN","USD-ZAR","EUR-KES","GBP-TZS","USD-UGX","EUR-XOF","GBP-ZAR","USD-GHS","AED-NGN"];
  const feeTypes = ["percentage","flat","tiered"];
  await run("fee_rules", 50, async () => {
    const feeType = pick(feeTypes);
    return q(`INSERT INTO fee_rules (corridor,min_amount,max_amount,fee_type,fee_percentage,fee_fixed,min_fee,max_fee,is_active,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW()-INTERVAL '${rnd(1,180)} days') ON CONFLICT DO NOTHING`,
      [pick(corridors), rnd(0,100), rnd(1000,50000), feeType, feeType==="percentage"?rndFloat(0.001,0.025,4):0, feeType==="flat"?rndFloat(0.5,5.0):0, rndFloat(0.25,1.0), rndFloat(25,100)]);
  });
}

// ── 5. referral_bonuses ──────────────────────────────────────────────────────
async function seedReferralBonuses() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (uids.length < 2) return;
  // Enum: referral_bonus_status: pending,approved,paid,expired,rejected
  const statuses = ["pending","approved","paid","expired","rejected"];
  const events = ["signup","first_transfer","volume_milestone","loyalty_tier"];
  await run("referral_bonuses", 50, async () => {
    const rid = pick(uids), eid = pick(uids.filter(id=>id!==rid));
    const status = pick(statuses);
    return q(`INSERT INTO referral_bonuses (referrer_id,referred_id,referral_code,referrer_bonus,referred_bonus,currency,status,trigger_event,paid_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::referral_bonus_status,$8,${status==="paid"?"NOW()-INTERVAL '"+rnd(1,30)+" days'":"NULL"},NOW()-INTERVAL '${rnd(1,90)} days') ON CONFLICT DO NOTHING`,
      [rid, eid, `REF${Math.random().toString(36).slice(2,8).toUpperCase()}`, rndFloat(5,50), rndFloat(2,25), pick(["USD","GBP","EUR"]), status, pick(events)]);
  });
}

// ── 6. compliance_alerts ─────────────────────────────────────────────────────
async function seedComplianceAlerts() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  const alertTypes = ["kyc_expiry","aml_hit","sanctions_match","pep_flag","high_risk_country","velocity_breach","ctr_threshold","sar_required"];
  const severities = ["low","medium","high","critical"];
  const statuses = ["open","under_review","escalated","resolved","dismissed"];
  await run("compliance_alerts", 50, async () => {
    const uid = pick(uids), status = pick(statuses);
    return q(`INSERT INTO compliance_alerts (alert_type,severity,title,description,related_user_id,status,resolved_at,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,${status==="resolved"?"NOW()-INTERVAL '"+rnd(1,20)+" days'":"NULL"},NOW()-INTERVAL '${rnd(1,120)} days') ON CONFLICT DO NOTHING`,
      [pick(alertTypes), pick(severities), `Compliance Alert: ${pick(alertTypes).replace(/_/g," ")}`, `Automated compliance flag detected for user ${uid}`, uid, status]);
  });
}

// ── 7. partner_api_keys ──────────────────────────────────────────────────────
async function seedPartnerApiKeys() {
  // Enums: partner_api_key_env: sandbox,production | partner_api_key_status: active,revoked,expired
  const partners = ["Flutterwave","Paystack","Chipper Cash","Sendwave","WorldRemit","Wise","Remitly","Xoom","Azimo","TransferGo","Paysend","Ria","Western Union","MoneyGram","Skrill"];
  const envs = ["production","production","sandbox","sandbox","sandbox"];
  const statuses = ["active","active","active","active","revoked","expired"];
  const permSets = [["transfers:read","transfers:write"],["fx:read","beneficiaries:read"],["transfers:read","fx:read"],["webhooks:manage","transfers:write"]];
  const adminIds = [14,169,7847];
  await run("partner_api_keys", 50, async () => {
    const partner = pick(partners), env = pick(envs), status = pick(statuses);
    const keyPrefix = env==="production"?"rf_live_":"rf_test_";
    return q(`INSERT INTO partner_api_keys (name,key_prefix,key_hash,environment,status,permissions,last_used_at,expires_at,created_by,created_at) VALUES ($1,$2,$3,$4::partner_api_key_env,$5::partner_api_key_status,$6,NOW()-INTERVAL '${rnd(1,30)} days',NOW()+INTERVAL '${rnd(90,365)} days',$7,NOW()-INTERVAL '${rnd(1,180)} days') ON CONFLICT DO NOTHING`,
      [`${partner} ${env.charAt(0).toUpperCase()+env.slice(1)} Key`,
       `${keyPrefix}${Math.random().toString(36).slice(2,10)}`,
       `sha256_${Math.random().toString(36).slice(2,34)}`,
       env, status, JSON.stringify(pick(permSets)), pick(adminIds)]);
  });
}

// ── 8. corridor_margin_history ───────────────────────────────────────────────
async function seedCorridorMargin() {
  // Actual schema: corridor_id, corridor_name, change_type, old_value, new_value, changed_by, changed_by_name, reason
  const corridors = [["USD-NGN","USD → NGN"],["GBP-NGN","GBP → NGN"],["EUR-GHS","EUR → GHS"],["USD-KES","USD → KES"],["GBP-GHS","GBP → GHS"],["USD-ZAR","USD → ZAR"],["EUR-KES","EUR → KES"],["CAD-NGN","CAD → NGN"]];
  const changeTypes = ["margin_bps","fee_percentage","rate_markup","min_fee","max_fee"];
  const adminIds = [14,169,7847];
  await run("corridor_margin_history", 50, async () => {
    const [cid,cname] = pick(corridors), ct = pick(changeTypes);
    const oldVal = rndFloat(25,200,1).toString(), newVal = rndFloat(25,200,1).toString();
    return q(`INSERT INTO corridor_margin_history (corridor_id,corridor_name,change_type,old_value,new_value,changed_by,changed_by_name,reason,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()-INTERVAL '${rnd(1,365)} days') ON CONFLICT DO NOTHING`,
      [cid, cname, ct, oldVal, newVal, pick(adminIds), "Admin User", `Adjusted ${ct.replace(/_/g," ")} for competitiveness`]);
  });
}

// ── 9. notifications ─────────────────────────────────────────────────────────
async function seedNotifications() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  const types = ["transfer_sent","transfer_received","kyc_approved","rate_alert","promo","security_alert","system","compliance_flag"];
  await run("notifications", 100, async () => {
    const uid = pick(uids), type = pick(types), isRead = Math.random() > 0.4;
    const titles = {transfer_sent:"Transfer Sent",transfer_received:"Money Received",kyc_approved:"KYC Approved",rate_alert:"Rate Alert",promo:"Special Offer",security_alert:"Security Notice",system:"System Update",compliance_flag:"Compliance Notice"};
    return q(`INSERT INTO notifications ("userId",title,message,type,"isRead",metadata,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()-INTERVAL '${rnd(1,60)} days') ON CONFLICT DO NOTHING`,
      [uid, titles[type]||"RemitFlow Update", `Your ${type.replace(/_/g," ")} notification.`, type, isRead,
       JSON.stringify({amount:rndFloat(50,5000),currency:pick(CURRENCIES),ref:`RF${rnd(100000,999999)}`})]);
  });
}

// ── 10. sanctions_checks ─────────────────────────────────────────────────────
async function seedSanctionsChecks() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  // Enum: sanctions_check_result: clear, hit, pending_review
  const results = ["clear","clear","clear","clear","hit","pending_review"];
  const lists = ["OFAC_SDN","EU_SANCTIONS","UN_SANCTIONS","HM_TREASURY","INTERPOL"];
  await run("sanctions_checks", 50, async () => {
    const uid = pick(uids), result = pick(results);
    const screeningId = `SCR-${Date.now()}-${rnd(1000,9999)}`;
    return q(`INSERT INTO sanctions_checks (screening_id,user_id,entity_name,entity_type,result,risk_level,lists_checked,match_details,reviewed_by,reviewed_at,created_at) VALUES ($1,$2,$3,$4,$5::sanctions_check_result,$6,$7,$8,$9,${result!=="clear"?"NOW()-INTERVAL '"+rnd(1,10)+" days'":"NULL"},NOW()-INTERVAL '${rnd(1,180)} days') ON CONFLICT DO NOTHING`,
      [screeningId, uid, `User ${uid}`, "individual", result,
       result==="clear"?"low":result==="hit"?"high":"medium",
       [pick(lists)],
       result!=="clear"?JSON.stringify({score:rndFloat(0.6,0.95,3),reason:"Name similarity"}):null,
       result!=="clear"?"compliance@remitflow.com":null]);
  });
}

// ── 11. rate_locks ───────────────────────────────────────────────────────────
async function seedRateLocks() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  const corridors = [["USD","NGN",1538],["GBP","NGN",1950],["EUR","GHS",16.2],["USD","KES",129],["GBP","GHS",20.1],["USD","ZAR",18.7]];
  const statuses = ["active","used","expired"];
  await run("rate_locks", 50, async () => {
    const [fc,tc,br] = pick(corridors);
    return q(`INSERT INTO rate_locks (user_id,from_currency,to_currency,locked_rate,amount,expires_at,status,created_at) VALUES ($1,$2,$3,$4,$5,NOW()+INTERVAL '${rnd(5,30)} minutes',$6,NOW()-INTERVAL '${rnd(1,60)} days') ON CONFLICT DO NOTHING`,
      [pick(uids), fc, tc, rndFloat(br*0.95,br*1.05,4), rndFloat(100,10000), pick(statuses)]);
  });
}

// ── 12. scheduled_transfers ──────────────────────────────────────────────────
async function seedScheduledTransfers() {
  const { rows: ur } = await q("SELECT id FROM users LIMIT 30");
  const { rows: br } = await q("SELECT id FROM beneficiaries LIMIT 100");
  const uids = ur.map(r=>r.id), bids = br.map(r=>r.id);
  if (!uids.length || !bids.length) return;
  const freqs = ["weekly","biweekly","monthly","quarterly"];
  const statuses = ["active","paused","completed","cancelled"];
  const corridors = [["USD","NGN"],["GBP","NGN"],["EUR","GHS"],["USD","KES"],["GBP","GHS"]];
  await run("scheduled_transfers", 50, async () => {
    const [fc,tc] = pick(corridors);
    return q(`INSERT INTO scheduled_transfers (user_id,beneficiary_id,from_currency,to_currency,amount,frequency,next_run_at,status,run_count,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '${rnd(1,30)} days',$7,$8,NOW()-INTERVAL '${rnd(1,180)} days') ON CONFLICT DO NOTHING`,
      [pick(uids), pick(bids), fc, tc, rndFloat(50,2000), pick(freqs), pick(statuses), rnd(0,24)]);
  });
}

// ── 13. webhook_endpoints ────────────────────────────────────────────────────
async function seedWebhookEndpoints() {
  const adminIds = [14,169,7847];
  const partners = ["Flutterwave","Paystack","Chipper Cash","Sendwave","WorldRemit","Wise","Remitly","Xoom","Azimo","TransferGo"];
  const eventSets = [["transfer.completed","transfer.failed"],["kyc.approved","kyc.rejected"],["payment.received","payment.sent"],["rate.alert","compliance.flag"]];
  await run("webhook_endpoints", 50, async () => {
    const partner = pick(partners);
    return q(`INSERT INTO webhook_endpoints (user_id,url,secret,events,is_active,description,failure_count,"createdAt","updatedAt") VALUES ($1,$2,$3,$4::json,true,$5,0,NOW()-INTERVAL '${rnd(1,180)} days',NOW()) ON CONFLICT DO NOTHING`,
      [pick(adminIds),
       `https://api.${partner.toLowerCase().replace(/ /g,"-")}.com/webhooks/remitflow`,
       `whsec_${Math.random().toString(36).slice(2,34)}`,
       JSON.stringify(pick(eventSets)),
       `${partner} webhook integration`]);
  });
}

// ── 14. exchange_rate_alerts ─────────────────────────────────────────────────
async function seedExchangeRateAlerts() {
  const { rows } = await q("SELECT id FROM users LIMIT 50");
  const uids = rows.map(r=>r.id);
  if (!uids.length) return;
  const corridors = [["USD","NGN",1538],["GBP","NGN",1950],["EUR","GHS",16.2],["USD","KES",129],["GBP","GHS",20.1]];
  const directions = ["above","below"];
  await run("exchange_rate_alerts", 50, async () => {
    const [fc,tc,br] = pick(corridors), dir = pick(directions);
    const target = dir==="above"?rndFloat(br*1.01,br*1.1,4):rndFloat(br*0.9,br*0.99,4);
    const isActive = Math.random()>0.3, triggered = !isActive && Math.random()>0.5;
    return q(`INSERT INTO exchange_rate_alerts (user_id,from_currency,to_currency,target_rate,direction,is_active,triggered_at,notification_sent,"createdAt") VALUES ($1,$2,$3,$4,$5,$6,${triggered?"NOW()-INTERVAL '"+rnd(1,30)+" days'":"NULL"},$7,NOW()-INTERVAL '${rnd(1,90)} days') ON CONFLICT DO NOTHING`,
      [pick(uids), fc, tc, target, dir, isActive, triggered]);
  });
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  RemitFlow v100 — Live Database Seed Script              ║");
  console.log("╚══════════════════════════════════════════════════════════╝");

  try {
    const res = await q("SELECT COUNT(*) FROM users");
    console.log(`\n✅ Connected — ${res.rows[0].count} existing users`);
  } catch (e) {
    console.error("❌ DB connection failed:", e.message); process.exit(1);
  }

  await seedTreasury();
  await seedOpenBanking();
  await seedFraudAlerts();
  await seedFeeRules();
  await seedReferralBonuses();
  await seedComplianceAlerts();
  await seedPartnerApiKeys();
  await seedCorridorMargin();
  await seedNotifications();
  await seedSanctionsChecks();
  await seedRateLocks();
  await seedScheduledTransfers();
  await seedWebhookEndpoints();
  await seedExchangeRateAlerts();

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log(`║  ✅ Seed Complete! Total inserted: ${String(total).padEnd(22)}║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  for (const [t,n] of Object.entries(summary)) {
    console.log(`║  ${t.padEnd(36)} ${String(n).padStart(4)} records  ║`);
  }
  console.log("╚══════════════════════════════════════════════════════════╝");
  await pool.end();
}

main().catch(async e => { console.error("❌ Fatal:", e.message); await pool.end(); process.exit(1); });
