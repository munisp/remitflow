
// ── PostgreSQL Write-Through ─────────────────────────────────────────────────
let _wtDb_costMonitoringts: any = null;
async function _getWtDb_costMonitoringts() {
  if (_wtDb_costMonitoringts) return _wtDb_costMonitoringts;
  try {
    const { getDb } = await import("../db.js");
    _wtDb_costMonitoringts = await getDb();
    return _wtDb_costMonitoringts;
  } catch { return null; }
}
async function _writeThrough(table: string, key: string, value: unknown): Promise<void> {
  const db = await _getWtDb_costMonitoringts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`
      INSERT INTO ${sql.raw(table)} (key, data, updated_at)
      VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `);
  } catch { /* hot cache still works */ }
}
async function _deleteFromDb(table: string, key: string): Promise<void> {
  const db = await _getWtDb_costMonitoringts();
  if (!db) return;
  try {
    const { sql } = await import("drizzle-orm");
    await (db as any).execute(sql`DELETE FROM ${sql.raw(table)} WHERE key = ${key}`);
  } catch {}
}

/**
 * Cost Monitoring — P2 Observability 7.8
 * Tracks infrastructure costs, per-transaction unit economics, and budget alerts.
 */

interface CostEntry {
  service: string;
  category: "compute" | "database" | "network" | "storage" | "third_party" | "other";
  amount: number;
  currency: string;
  period: string;
  timestamp: number;
}

interface BudgetAlert {
  name: string;
  monthlyBudget: number;
  currentSpend: number;
  threshold: number; // 0-1
  triggered: boolean;
}

const costEntries: CostEntry[] = [];
const budgets = new Map<string, BudgetAlert>();

// Default infrastructure cost estimates
const INFRA_COSTS: Record<string, { monthly: number; category: CostEntry["category"] }> = {
  "eks-cluster": { monthly: 73, category: "compute" },
  "rds-primary": { monthly: 200, category: "database" },
  "rds-read-replica": { monthly: 150, category: "database" },
  "elasticache-redis": { monthly: 50, category: "database" },
  "s3-storage": { monthly: 23, category: "storage" },
  "cloudfront-cdn": { monthly: 15, category: "network" },
  "nat-gateway": { monthly: 45, category: "network" },
  "load-balancer": { monthly: 22, category: "network" },
  "kafka-msk": { monthly: 130, category: "compute" },
  "monitoring-datadog": { monthly: 75, category: "other" },
  "sentry-error-tracking": { monthly: 26, category: "other" },
  "stripe-payment-processing": { monthly: 0, category: "third_party" }, // per-transaction
  "flutterwave-api": { monthly: 0, category: "third_party" },
  "twilio-sms": { monthly: 50, category: "third_party" },
  "sendgrid-email": { monthly: 20, category: "third_party" },
};

export function recordCost(service: string, amount: number, category: CostEntry["category"], currency = "USD"): void {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  costEntries.push({ service, category, amount, currency, period, timestamp: Date.now() });
}

export function getMonthlySpend(month?: string): {
  total: number;
  byCategory: Record<string, number>;
  byService: Record<string, number>;
  period: string;
} {
  const period = month ?? new Date().toISOString().slice(0, 7);
  const entries = costEntries.filter((e) => e.period === period);

  const byCategory: Record<string, number> = {};
  const byService: Record<string, number> = {};
  let total = 0;

  for (const entry of entries) {
    total += entry.amount;
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + entry.amount;
    byService[entry.service] = (byService[entry.service] ?? 0) + entry.amount;
  }

  return { total: Math.round(total * 100) / 100, byCategory, byService, period };
}

export function getUnitEconomics(transactionCount: number): {
  costPerTransaction: number;
  monthlyInfraCost: number;
  breakEvenTransactions: number;
  avgRevenuePerTransaction: number;
} {
  const infraCost = Object.values(INFRA_COSTS).reduce((s, c) => s + c.monthly, 0);
  const avgRevenue = 3.5; // average fee per transaction
  const costPerTx = transactionCount > 0 ? infraCost / transactionCount : infraCost;
  const breakEven = Math.ceil(infraCost / avgRevenue);

  return {
    costPerTransaction: Math.round(costPerTx * 100) / 100,
    monthlyInfraCost: infraCost,
    breakEvenTransactions: breakEven,
    avgRevenuePerTransaction: avgRevenue,
  };
}

export function setBudget(name: string, monthlyBudget: number, threshold = 0.8): void {
  budgets.set(name, { name, monthlyBudget, currentSpend: 0, threshold, triggered: false });
  _writeThrough("wt_cost_monitoring_budgets", String(name), { name, monthlyBudget, currentSpend: 0, threshold, triggered: false }).catch(() => {});
}

export function checkBudgets(): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  budgets.forEach((budget) => {
    const spend = getMonthlySpend();
    budget.currentSpend = spend.total;
    if (budget.currentSpend >= budget.monthlyBudget * budget.threshold && !budget.triggered) {
      budget.triggered = true;
      alerts.push(budget);
    }
  });
  return alerts;
}

export function getInfraCostEstimate(): {
  monthly: number;
  annual: number;
  services: Array<{ name: string; monthly: number; category: string }>;
} {
  const services = Object.entries(INFRA_COSTS).map(([name, config]) => ({
    name,
    monthly: config.monthly,
    category: config.category,
  }));

  const monthly = services.reduce((s, svc) => s + svc.monthly, 0);

  return { monthly, annual: monthly * 12, services };
}
