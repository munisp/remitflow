/**
 * seed-liveness-audit.ts — Seed kyc_liveness_audit with 30 realistic rows
 * across 8 corridors (NG, GH, KE, SN, ZA, GB, US, CA).
 * Run: npx tsx drizzle/seed-liveness-audit.ts
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
const client = postgres(url, { max: 5, connect_timeout: 10 });
const db = drizzle(client, { schema });

function rnd(min: number, max: number, decimals = 4): string {
  return (Math.random() * (max - min) + min).toFixed(decimals);
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("🌱 Seeding kyc_liveness_audit...");

  const existingUsers = await db.select({ id: schema.users.id }).from(schema.users).limit(10);
  if (existingUsers.length < 1) {
    console.error("❌ No users found — run seed.ts first.");
    await client.end();
    return;
  }

  const userIds = existingUsers.map((u) => u.id);

  const corridors = ["NG", "GH", "KE", "SN", "ZA", "GB", "US", "CA"];
  const spoofingTypes = ["printed_photo", "screen_replay", "paper_mask", "3d_mask", "deepfake", "high_quality_photo", null, null, null];
  const deepfakeMethods = ["vit_l_primary", "dct_frequency", "mediapipe_landmarks"];
  const sources = ["trpc_extract", "temporal_workflow", "manual_review"];

  // Generate 30 rows spread across corridors
  // Roughly 3-4 rows per corridor, with a mix of pass/fail outcomes
  const rows: (typeof schema.kycLivenessAudit.$inferInsert)[] = [];

  const now = Date.now();
  const oneWeek = 7 * 24 * 3600 * 1000;

  for (let i = 0; i < 30; i++) {
    const corridor = corridors[i % corridors.length];
    const userId = userIds[i % userIds.length];

    // Simulate realistic score distributions
    // Most pass (80%), some fail (20%)
    const isFail = Math.random() < 0.2;
    const isDeepfake = Math.random() < 0.07; // ~7% deepfake rate

    const passiveScore = isFail ? rnd(0.1, 0.45) : rnd(0.65, 0.99);
    const passivePassed = parseFloat(passiveScore) >= 0.5;

    const deepfakeScore = isDeepfake ? rnd(0.55, 0.95) : rnd(0.02, 0.30);
    const deepfakePassed = parseFloat(deepfakeScore) < 0.5;

    const activePassed = !isFail || Math.random() > 0.5;
    const overallLive = passivePassed && deepfakePassed && activePassed;

    // Spread timestamps over the past week
    const createdAt = new Date(now - Math.random() * oneWeek);

    rows.push({
      userId,
      passiveScore,
      passivePassed,
      passiveSpoofingType: isFail ? pick(spoofingTypes.filter(Boolean) as string[]) : null,
      activeBlinkCount: Math.floor(Math.random() * 4) + 1,
      activeHeadMovementDeg: rnd(5, 35, 2),
      activePassed,
      deepfakeScore,
      deepfakeMethod: pick(deepfakeMethods),
      deepfakeIndicators: isDeepfake
        ? pick([
            ["temporal_inconsistency", "eye_blink_anomaly"],
            ["face_boundary_artifact", "texture_mismatch"],
            ["frequency_domain_anomaly"],
          ])
        : [],
      deepfakePassed,
      corridorCode: corridor,
      overallLive,
      source: pick(sources),
      createdAt,
    });
  }

  await db.insert(schema.kycLivenessAudit).values(rows).onConflictDoNothing();

  const count = await db.select({ id: schema.kycLivenessAudit.id }).from(schema.kycLivenessAudit);
  console.log(`✅ kyc_liveness_audit seeded — ${count.length} total rows.`);
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => client.end());
