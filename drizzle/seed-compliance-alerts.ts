/**
 * seed-compliance-alerts.ts — Enrich compliance_alerts with realistic titles,
 * descriptions, and metadata, and seed compliance_alert_notes.
 * Run: npx tsx drizzle/seed-compliance-alerts.ts
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { eq } from "drizzle-orm";

const url = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
const client = postgres(url, { max: 3, connect_timeout: 10 });
const db = drizzle(client, { schema });

// Realistic alert templates per alert_type
const TEMPLATES: Record<string, { titles: string[]; descriptions: string[] }> = {
  aml_flag: {
    titles: [
      "AML Flag — Structuring pattern detected: multiple sub-threshold deposits",
      "AML Flag — Unusual cash-equivalent transfers to high-risk jurisdiction",
      "AML Flag — Rapid layering: 12 transfers within 4-hour window",
      "AML Flag — Round-dollar transfers consistent with placement stage",
    ],
    descriptions: [
      "Customer made 9 deposits of $490–$499 over 3 days, consistent with structuring to avoid $500 reporting threshold. Total exposure: $4,320. Referred to MLRO for SAR assessment.",
      "Three transfers totalling $8,750 sent to counterparties in Myanmar (FATF grey-listed). No apparent business purpose declared. Pending enhanced due diligence review.",
      "Account executed 12 outbound transfers in a 4-hour window, dispersing $23,400 across 8 beneficiaries in 5 countries. Pattern consistent with layering stage of money laundering.",
      "Customer initiated 6 round-dollar transfers ($1,000 each) to the same beneficiary within 48 hours. No invoice or business justification provided.",
    ],
  },
  kyc_expiry: {
    titles: [
      "KYC Expiry — Tier 3 identity documents expire in 14 days",
      "KYC Expiry — Proof of address document expired 30 days ago",
      "KYC Expiry — Enhanced due diligence refresh overdue (PEP customer)",
      "KYC Expiry — Business registration certificate expired",
    ],
    descriptions: [
      "Customer's national ID (NGA-2019-4471882) expires on the 30th. Account will be downgraded to Tier 1 limits ($500/day) if not renewed. Automated reminder sent on day 30 and day 14.",
      "Utility bill submitted as proof of address is dated 14 months ago, exceeding the 90-day freshness requirement. Customer notified; 7-day grace period in effect.",
      "PEP-flagged customer (senior government official) is due for annual enhanced due diligence refresh. Last review: 13 months ago. Regulatory requirement: annual.",
      "SME account holder's CAC certificate expired 45 days ago. Business account restricted to inbound-only until renewed documentation is submitted.",
    ],
  },
  sanctions_hit: {
    titles: [
      "Sanctions Hit — OFAC SDN list match: Adebayo Okafor, confidence 84%",
      "Sanctions Hit — EU Consolidated List partial match on beneficiary name",
      "Sanctions Hit — UN Security Council designation match on sending entity",
      "Sanctions Hit — HM Treasury OFSI match: Iranian shipping company",
    ],
    descriptions: [
      "Fuzzy name match (Levenshtein distance 2) against OFAC SDN entry #12847. Customer: Adebayo Okafor (DOB 1978-03-15, Lagos). SDN entry: Adebayo Okafor (DOB 1978-03-15, Lagos). Confidence: 84%. Transaction frozen pending manual review.",
      "Beneficiary name 'Al-Rashid Trading LLC' partially matches EU Consolidated List entry for 'Al-Rashid Trading Company' (Syria). Transaction value: €4,200. Awaiting compliance officer decision.",
      "Sending entity 'Pyongyang Export Corp' matches UN Security Council resolution 1718 designation. Transfer blocked automatically. Incident report filed with NCA.",
      "Correspondent bank flagged counterparty as matching HM Treasury OFSI designation for Iranian shipping entity under JCPOA sanctions. Transfer of £12,500 suspended.",
    ],
  },
  velocity_breach: {
    titles: [
      "Velocity Breach — 24-hour send limit exceeded: $15,200 vs $10,000 cap",
      "Velocity Breach — Weekly transaction count limit: 47 transactions in 7 days",
      "Velocity Breach — Monthly outbound volume 340% above 3-month average",
      "Velocity Breach — Beneficiary concentration: 95% of volume to single recipient",
    ],
    descriptions: [
      "Customer sent $15,200 in the last 24 hours, exceeding the $10,000 daily limit for Tier 2 accounts. Account temporarily restricted. Customer must complete Tier 3 KYC to restore full limits.",
      "Account executed 47 transactions in the past 7 days against a 30-transaction weekly limit. Pattern suggests automated or scripted activity. Account under review.",
      "Outbound transfer volume this month is $42,300, compared to a 3-month average of $12,400 (340% increase). No change in declared income or business activity. Escalated to MLRO.",
      "94.7% of all outbound volume ($38,100 of $40,250) sent to a single beneficiary (Ref: BEN-00291) over the past 30 days. Potential concentration risk or pass-through activity.",
    ],
  },
  unusual_pattern: {
    titles: [
      "Unusual Pattern — Night-time transaction cluster: 23 transfers between 02:00–04:00",
      "Unusual Pattern — Geographic anomaly: account accessed from 4 countries in 12 hours",
      "Unusual Pattern — Dormant account suddenly activated with large inbound transfer",
      "Unusual Pattern — Rapid beneficiary cycling: 28 new beneficiaries in 7 days",
    ],
    descriptions: [
      "Customer executed 23 transfers between 02:00 and 04:00 local time over the past week. This is statistically anomalous (>3σ from baseline). ML fraud model score: 0.87.",
      "Account login events detected from Nigeria (08:00), UK (10:30), UAE (14:00), and Canada (20:00) within a 12-hour window. Physical travel is implausible. Possible account compromise.",
      "Account dormant for 18 months received a $25,000 inbound transfer, followed by 6 outbound transfers totalling $24,800 within 2 hours. Classic pass-through pattern.",
      "Customer added 28 new beneficiaries in 7 days, compared to a historical average of 1.2/month. Beneficiaries span 9 countries. Possible mule network activity.",
    ],
  },
  pep_match: {
    titles: [
      "PEP Match — Customer identified as Politically Exposed Person (Tier 1)",
      "PEP Match — Close associate of PEP detected in transaction network",
      "PEP Match — Customer's employer is state-owned enterprise",
      "PEP Match — Beneficial owner of corporate account is PEP",
    ],
    descriptions: [
      "Customer Chukwuemeka Adeyemi matched against PEP database as serving member of Nigerian National Assembly (House of Representatives). Enhanced due diligence required. Source of funds documentation requested.",
      "Transaction network analysis identified that customer's primary beneficiary (Ref: BEN-00145) is the spouse of a senior Central Bank official. Relationship declared: 'family'. EDD triggered.",
      "Customer's declared employer, Nigeria Ports Authority, is a state-owned enterprise. Customer's role (Director of Finance) qualifies as PEP under FATF guidance. EDD review initiated.",
      "Corporate account beneficial owner (>25% shareholding) identified as former Minister of Petroleum. PEP status requires annual EDD review and senior management sign-off for high-value transactions.",
    ],
  },
  high_risk_country: {
    titles: [
      "High-Risk Country — Transfer to FATF grey-listed jurisdiction: Myanmar",
      "High-Risk Country — Correspondent bank in sanctioned country detected",
      "High-Risk Country — Customer's source of funds from high-risk jurisdiction",
      "High-Risk Country — Beneficiary address in OFAC-sanctioned territory",
    ],
    descriptions: [
      "Customer initiated transfer of $3,400 to a beneficiary in Myanmar, which was added to the FATF grey list in June 2022. Enhanced monitoring applied. Transfer requires compliance officer approval.",
      "Payment routing passes through a correspondent bank in Iran (SWIFT BIC: MELIHITH). All transactions through this corridor are automatically blocked per OFAC regulations.",
      "Customer's declared source of funds is rental income from properties in North Korea. This is a prohibited jurisdiction. Account suspended pending investigation.",
      "Beneficiary's registered address is in Crimea, a sanctioned territory under OFAC's Ukraine-/Russia-Related Sanctions. Transfer of $7,800 blocked automatically.",
    ],
  },
};

// Status-to-note templates for audit trail
const STATUS_NOTES: Record<string, string[]> = {
  open: ["Alert auto-generated by compliance engine. Assigned to compliance queue for review."],
  acknowledged: [
    "Alert reviewed and acknowledged. Initial assessment: requires further investigation.",
    "Case acknowledged. Requesting additional documentation from customer.",
  ],
  under_review: [
    "Under active investigation. Customer contacted for source of funds documentation.",
    "Transaction records pulled from core banking. Awaiting MLRO review.",
    "External data sources checked (Refinitiv World-Check, Dow Jones). Findings documented.",
  ],
  resolved: [
    "Investigation complete. Alert determined to be false positive. Customer cleared.",
    "SAR filed with NCA (reference: SAR-2024-00891). Account restrictions applied.",
    "Customer provided satisfactory explanation and supporting documentation. Case closed.",
  ],
  escalated: [
    "Escalated to MLRO for senior review. Potential SAR filing required.",
    "Escalated to Financial Crime team. Law enforcement liaison notified.",
    "Board-level escalation triggered per policy for transactions >$50,000 with sanctions exposure.",
  ],
};

async function main() {
  console.log("🌱 Enriching compliance alerts with realistic data...");

  // Resolve user IDs
  const users = await db.select({ id: schema.users.id }).from(schema.users).limit(5);
  if (users.length < 1) {
    console.error("❌ No users found — run seed.ts first.");
    await client.end();
    return;
  }
  const adminId = users[0].id;
  const analystId = users[Math.min(1, users.length - 1)].id;

  // Get all existing alerts
  const alerts = await db.select().from(schema.complianceAlerts).orderBy(schema.complianceAlerts.id);
  console.log(`  → Found ${alerts.length} alerts to enrich`);

  const alertTypes = Object.keys(TEMPLATES);
  let enriched = 0;
  let notesAdded = 0;

  for (const alert of alerts) {
    const type = alert.alertType as string;
    const templateKey = alertTypes.find(k => type.toLowerCase().includes(k.replace(/_/g, "_"))) || "aml_flag";
    const tmpl = TEMPLATES[templateKey] || TEMPLATES.aml_flag;
    const idx = (alert.id - 1) % tmpl.titles.length;

    const newTitle = tmpl.titles[idx];
    const newDescription = tmpl.descriptions[idx];
    const metadataObj = {
      riskScore: Math.round(40 + Math.random() * 55),
      transactionAmount: Math.round(500 + Math.random() * 49500),
      currency: ["USD", "GBP", "EUR", "NGN", "GHS"][alert.id % 5],
      corridor: ["NG-GB", "GH-US", "KE-CA", "SN-FR", "ZA-AU"][alert.id % 5],
      engineVersion: "v2.4.1",
      matchConfidence: Math.round(60 + Math.random() * 39),
      reviewDeadline: new Date(Date.now() + (3 + (alert.id % 7)) * 24 * 60 * 60 * 1000).toISOString(),
    };

    await db.update(schema.complianceAlerts)
      .set({
        title: newTitle,
        description: newDescription,
        metadata: JSON.stringify(metadataObj),
      })
      .where(eq(schema.complianceAlerts.id, alert.id));
    enriched++;

    // Add audit trail notes based on status
    const status = alert.status as string;
    const noteTemplates = STATUS_NOTES[status] || STATUS_NOTES.open;
    const noteContent = noteTemplates[(alert.id - 1) % noteTemplates.length];

    // Check if notes already exist for this alert
    const existingNotes = await db.select({ id: schema.complianceAlertNotes.id })
      .from(schema.complianceAlertNotes)
      .where(eq(schema.complianceAlertNotes.alertId, alert.id))
      .limit(1);

    if (existingNotes.length === 0) {
      // Add initial system note
      await db.insert(schema.complianceAlertNotes).values({
        alertId: alert.id,
        authorId: adminId,
        content: noteContent,
        isInternal: true,
      });
      notesAdded++;

      // Add a second analyst note for non-open alerts
      if (status !== "open" && alert.id % 3 === 0) {
        await db.insert(schema.complianceAlertNotes).values({
          alertId: alert.id,
          authorId: analystId,
          content: `Follow-up: Risk score ${metadataObj.riskScore}/100. Corridor: ${metadataObj.corridor}. Transaction amount: ${metadataObj.currency} ${metadataObj.transactionAmount.toLocaleString()}.`,
          isInternal: true,
        });
        notesAdded++;
      }
    }
  }

  console.log(`  ✅ Enriched ${enriched} alerts`);
  console.log(`  ✅ Added ${notesAdded} audit notes`);
  console.log("🎉 Compliance alert enrichment complete!");
  await client.end();
}

main().catch(async (e) => {
  console.error("❌ Enrichment failed:", e);
  await client.end();
  process.exit(1);
});
