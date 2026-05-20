#!/usr/bin/env python3
"""Replace the single-corridor checkRateAlerts with a multi-corridor version."""

path = "/home/ubuntu/remitflow/server/routers/cbnCompliance.ts"

with open(path, "r") as f:
    content = f.read()

# Find the checkRateAlerts procedure start
start_marker = "  checkRateAlerts: protectedProcedure"
end_marker = "  // \u2500\u2500 CBN Compliance Export"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1:
    print("ERROR: checkRateAlerts start not found")
    exit(1)
if end_idx == -1:
    print("ERROR: CBN Compliance Export marker not found")
    exit(1)

new_procedure = '''  checkRateAlerts: protectedProcedure
    .mutation(async ({ ctx }) => {
      adminOnly(ctx);
      const db = getDb();

      // Fetch all active alerts
      const activeAlerts = await db
        .select()
        .from(exchangeRateAlerts)
        .where(eq(exchangeRateAlerts.isActive, true));
      if (activeAlerts.length === 0) return { checked: 0, triggered: 0, corridorsChecked: 0, alerts: [] };

      // Fetch all active corridors from cbnCorridors table (multi-corridor support)
      const activeCbnCorridors = await db
        .select({ corridor: cbnCorridors.corridor })
        .from(cbnCorridors)
        .where(eq(cbnCorridors.isActive, true));

      // Build a live rate map for all active corridors in parallel
      const liveRateMap = new Map<string, number>();
      await Promise.all(
        activeCbnCorridors.map(async ({ corridor }) => {
          try {
            const rate = await fetchBmatchRate(corridor);
            liveRateMap.set(corridor, parseFloat(rate.midRate ?? "0"));
          } catch {
            // If a corridor rate fetch fails, skip it gracefully
          }
        })
      );

      // Fetch approved BDC partners with email once (reused for all triggered alerts)
      const approvedBdcPartners = await db
        .select({ name: bdcPartners.name, contactEmail: bdcPartners.contactEmail })
        .from(bdcPartners)
        .where(eq(bdcPartners.status, "approved"));

      const triggered: typeof activeAlerts = [];

      for (const alert of activeAlerts) {
        const pair = `${alert.fromCurrency}/${alert.toCurrency}`;
        const liveRateNum = liveRateMap.get(pair);
        // Skip if we couldn\'t fetch a live rate for this pair
        if (liveRateNum === undefined) continue;

        const threshold = parseFloat(String(alert.targetRate));
        const breached =
          (alert.direction === "above" && liveRateNum >= threshold) ||
          (alert.direction === "below" && liveRateNum <= threshold);

        if (breached && !alert.notificationSent) {
          triggered.push(alert);
          await db
            .update(exchangeRateAlerts)
            .set({ notificationSent: true, triggeredAt: new Date() })
            .where(eq(exchangeRateAlerts.id, alert.id));

          await notifyOwner({
            title: `CBN Rate Alert Triggered: ${pair}`,
            content: `Alert ID ${alert.id}: ${pair} rate is ${liveRateNum.toFixed(4)} (threshold ${alert.direction} ${threshold}). Live BMATCH mid-rate: ${liveRateNum.toFixed(4)}.`,
          });

          // Send email to all approved BDC partners with contactEmail
          try {
            for (const partner of approvedBdcPartners) {
              if (!partner.contactEmail) continue;
              await sendEmail({
                to: partner.contactEmail,
                subject: `[RemitFlow CBN Alert] ${pair} rate ${alert.direction} ${threshold}`,
                html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px">
  <h2 style="color:#f59e0b;margin:0 0 12px">&#9888; CBN Corridor Rate Alert</h2>
  <p style="margin:0 0 8px">Dear <strong>${partner.name}</strong> Compliance Officer,</p>
  <p style="margin:0 0 16px">A CBN corridor rate alert has been triggered:</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <tr><td style="padding:6px 0;color:#94a3b8">Pair</td><td style="padding:6px 0;font-weight:700;color:#e2e8f0">${pair}</td></tr>
    <tr><td style="padding:6px 0;color:#94a3b8">Live Rate</td><td style="padding:6px 0;font-weight:700;color:#34d399">${liveRateNum.toFixed(4)}</td></tr>
    <tr><td style="padding:6px 0;color:#94a3b8">Threshold</td><td style="padding:6px 0;font-weight:700;color:#f59e0b">${alert.direction.toUpperCase()} ${threshold}</td></tr>
    <tr><td style="padding:6px 0;color:#94a3b8">Alert ID</td><td style="padding:6px 0;font-family:monospace;color:#a78bfa">#${alert.id}</td></tr>
    <tr><td style="padding:6px 0;color:#94a3b8">Triggered At</td><td style="padding:6px 0;color:#e2e8f0">${new Date().toUTCString()}</td></tr>
  </table>
  <p style="margin:16px 0 0;font-size:12px;color:#64748b">This is an automated CBN compliance alert from RemitFlow. Please review your FX exposure immediately.</p>
</div>`,
                text: `CBN Rate Alert: ${pair} rate is ${liveRateNum.toFixed(4)} (threshold ${alert.direction} ${threshold}). Alert ID: ${alert.id}. Triggered at: ${new Date().toUTCString()}.`,
              });
            }
          } catch (emailErr) {
            console.warn("[CBN Rate Alert] Email delivery failed:", emailErr);
          }

          await publishKafkaEvent("cbn-rate-alert-triggered", {
            alert_id: alert.id,
            pair,
            live_rate: liveRateNum,
            threshold,
            direction: alert.direction,
          });
        }
      }

      return {
        checked: activeAlerts.length,
        triggered: triggered.length,
        corridorsChecked: liveRateMap.size,
        liveRates: Object.fromEntries(liveRateMap),
        alerts: triggered.map((a) => ({
          id: a.id,
          pair: `${a.fromCurrency}/${a.toCurrency}`,
          direction: a.direction,
          threshold: a.targetRate,
        })),
      };
    }),

'''

new_content = content[:start_idx] + new_procedure + content[end_idx:]

with open(path, "w") as f:
    f.write(new_content)

print(f"checkRateAlerts replaced successfully. File size: {len(new_content)} chars")
