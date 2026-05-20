/**
 * Load Test v98 — Lesson 11 from 1B Payments/Day research
 *
 * Implements the 80/20 account skew pattern from the benchmark:
 * 80% of transfers involve the top 20% of accounts (Pareto distribution).
 *
 * Usage:
 *   node scripts/load-test-v98.mjs [--concurrency=10] [--transfers=10000] [--duration=300]
 *
 * Reference: https://github.com/pratikgajjar/1b-payments/blob/main/cmd/tb/transfers/main.go
 */

import postgres from 'postgres';
import { writeFileSync } from "fs";
import { randomUUID } from "crypto";
import dotenv from "dotenv";

dotenv.config();

// Parse CLI flags
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);

const CONCURRENCY = parseInt(args.concurrency ?? "10", 10);
const TOTAL_TRANSFERS = parseInt(args.transfers ?? "10000", 10);
const DURATION_SEC = parseInt(args.duration ?? "60", 10);

const DATABASE_URL = process.env.DATABASE_URL ?? process.env.LOCAL_DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

async function main() {
  console.log(`\n=== RemitFlow Load Test v98 ===`);
  console.log(`Concurrency: ${CONCURRENCY} workers`);
  console.log(`Target: ${TOTAL_TRANSFERS} transfers`);
  console.log(`Duration cap: ${DURATION_SEC}s`);
  console.log(`Pattern: 80/20 account skew (Pareto distribution)\n`);

  const sql = postgres(process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL, { max: 5, idle_timeout: 30 });
// postgres-js helper: simulate mysql2 execute(sql, params)
async function exec(q, params = []) {
  const parts = q.split('?');
  const strings = Object.assign(parts, { raw: parts });
  return sql(strings, ...params);
}


  // Fetch all wallet IDs
  const [walletRows] = await exec("SELECT id, user_id FROM wallets LIMIT 10000");
  const wallets = walletRows;

  if (wallets.length < 2) {
    console.error("Need at least 2 wallets in the database. Run seed scripts first.");
    await sql.end();
    process.exit(1);
  }

  // 80/20 split: top 20% of wallets are "hot" accounts
  const top20Count = Math.max(2, Math.floor(wallets.length * 0.2));
  const hotWallets = wallets.slice(0, top20Count);
  const allWallets = wallets;

  console.log(`Total wallets: ${wallets.length}`);
  console.log(`Hot wallets (top 20%): ${hotWallets.length}`);
  console.log(`Cold wallets (bottom 80%): ${wallets.length - hotWallets.length}\n`);

  let totalOK = 0;
  let totalErr = 0;
  const latencies = [];
  const startTime = Date.now();
  const deadline = startTime + DURATION_SEC * 1000;

  // Worker function
  async function worker(workerId) {
    const transfersPerWorker = Math.ceil(TOTAL_TRANSFERS / CONCURRENCY);

    for (let i = 0; i < transfersPerWorker; i++) {
      if (Date.now() > deadline) break;

      // 80/20 skew: 80% chance of using a hot wallet as sender
      const useHot = Math.random() < 0.8;
      const senderPool = useHot ? hotWallets : allWallets;
      const senderIdx = Math.floor(Math.random() * senderPool.length);
      const sender = senderPool[senderIdx];

      // Receiver is always random from all wallets (excluding sender)
      let receiver;
      do {
        receiver = allWallets[Math.floor(Math.random() * allWallets.length)];
      } while (receiver.id === sender.id);

      const t0 = Date.now();
      try {
        const conn = { sql };
        try {
          await conn.beginTransaction();
          await exec(
            `INSERT INTO transfers 
             (user_id, recipient_id, amount, currency, type, status, description, idempotency_key, created_at, updated_at)
             VALUES (?, ?, ?, 'USD', 'SEND', 'COMPLETED', 'load-test', ?, NOW(), NOW())`,
            [sender.user_id, receiver.user_id, "1.00", randomUUID()]
          );
          await conn.commit();
          totalOK++;
        } catch (e) {
          await conn.rollback();
          totalErr++;
        } finally {
          // conn.release() not needed with postgres driver
        }
      } catch {
        totalErr++;
      }

      latencies.push(Date.now() - t0);
    }
  }

  // Launch concurrent workers
  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  const elapsed = (Date.now() - startTime) / 1000;
  const rps = totalOK / elapsed;

  // Compute percentiles
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

  const results = {
    timestamp: new Date().toISOString(),
    config: { concurrency: CONCURRENCY, totalTransfers: TOTAL_TRANSFERS, durationSec: DURATION_SEC },
    results: {
      totalOK,
      totalErr,
      elapsedSec: elapsed.toFixed(2),
      rps: rps.toFixed(2),
      errorRate: ((totalErr / (totalOK + totalErr)) * 100).toFixed(2) + "%",
    },
    latencyMs: { p50, p95, p99, min: latencies[0] ?? 0, max: latencies[latencies.length - 1] ?? 0 },
    accountSkew: {
      hotWallets: hotWallets.length,
      coldWallets: wallets.length - hotWallets.length,
      hotRatio: "80%",
    },
  };

  console.log("\n=== Results ===");
  console.log(`OK: ${totalOK} | Errors: ${totalErr} | Elapsed: ${elapsed.toFixed(2)}s`);
  console.log(`RPS: ${rps.toFixed(2)} | Error rate: ${results.results.errorRate}`);
  console.log(`Latency — p50: ${p50}ms | p95: ${p95}ms | p99: ${p99}ms`);

  const outputPath = "docs/load-test-results.json";
  writeFileSync(outputPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to ${outputPath}`);

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
