import re

with open('server/routers.ts', 'r') as f:
    content = f.read()

new_routers = '''
  // ─── FRAUD MONITORING (Admin) ─────────────────────────────────────────────
  fraudMonitor: router({
    alerts: protectedProcedure.input(z.object({
      status: z.enum(["all","pending","reviewed","approved","blocked","escalated"]).default("all"),
      riskLevel: z.enum(["all","low","medium","high","critical"]).default("all"),
      page: z.number().default(1),
      limit: z.number().default(20),
    })).query(async ({ input }) => {
      const db = await getDb(); if (!db) return { alerts: [], total: 0, stats: {} };
      const conditions: string[] = [];
      if (input.status !== "all") conditions.push(`fa.status = '${input.status}'`);
      if (input.riskLevel !== "all") conditions.push(`fa.risk_level = '${input.riskLevel}'`);
      const whereStr = conditions.length > 0 ? conditions.join(" AND ") : "1=1";
      const offset = (input.page - 1) * input.limit;
      const [rows] = await db.execute(sql.raw(`SELECT fa.*, u.name as user_name, u.email as user_email FROM fraud_alerts fa LEFT JOIN users u ON fa.user_id = u.id WHERE ${whereStr} ORDER BY fa.created_at DESC LIMIT ${input.limit} OFFSET ${offset}`));
      const [countRows] = await db.execute(sql.raw(`SELECT COUNT(*) as total FROM fraud_alerts fa WHERE ${whereStr}`));
      const [statsRows] = await db.execute(sql.raw(`SELECT status, COUNT(*) as count, risk_level FROM fraud_alerts GROUP BY status, risk_level`));
      const total = (countRows as any[])[0]?.total ?? 0;
      const stats: Record<string, number> = { pending: 0, reviewed: 0, approved: 0, blocked: 0, escalated: 0, critical: 0, high: 0, medium: 0, low: 0 };
      for (const row of statsRows as any[]) {
        stats[row.status] = (stats[row.status] ?? 0) + Number(row.count);
        stats[row.risk_level] = (stats[row.risk_level] ?? 0) + Number(row.count);
      }
      return { alerts: rows as any[], total: Number(total), stats };
    }),
    reviewAlert: protectedProcedure.input(z.object({
      alertId: z.number(),
      action: z.enum(["approve","block","escalate","review"]),
      notes: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const statusMap: Record<string, string> = { approve: "approved", block: "blocked", escalate: "escalated", review: "reviewed" };
      const newStatus = statusMap[input.action];
      await db.execute(sql.raw(`UPDATE fraud_alerts SET status = '${newStatus}', reviewer_id = ${ctx.user.id}, reviewer_notes = ${db.escape(input.notes ?? "")}, reviewed_at = NOW(), updated_at = NOW() WHERE id = ${input.alertId}`));
      await createAuditLog({ userId: ctx.user.id, action: "FRAUD_ALERT_REVIEWED", description: `Alert #${input.alertId} ${input.action}d` });
      return { success: true };
    }),
    stats: protectedProcedure.query(async () => {
      const db = await getDb(); if (!db) return { totalAlerts: 0, pendingReview: 0, blockedToday: 0, amountBlocked: 0, riskDistribution: [], recentActivity: [] };
      const [statsRows] = await db.execute(sql.raw(`SELECT COUNT(*) as total_alerts, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_review, SUM(CASE WHEN status = 'blocked' AND DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as blocked_today, SUM(CASE WHEN status = 'blocked' THEN transaction_amount ELSE 0 END) as amount_blocked, AVG(risk_score) as avg_risk_score FROM fraud_alerts`));
      const [riskDist] = await db.execute(sql.raw(`SELECT risk_level, COUNT(*) as count FROM fraud_alerts GROUP BY risk_level`));
      const [recent] = await db.execute(sql.raw(`SELECT fa.*, u.name as user_name FROM fraud_alerts fa LEFT JOIN users u ON fa.user_id = u.id ORDER BY fa.created_at DESC LIMIT 5`));
      const s = (statsRows as any[])[0] ?? {};
      return {
        totalAlerts: Number(s.total_alerts ?? 0),
        pendingReview: Number(s.pending_review ?? 0),
        blockedToday: Number(s.blocked_today ?? 0),
        amountBlocked: Number(s.amount_blocked ?? 0),
        avgRiskScore: Number(s.avg_risk_score ?? 0),
        riskDistribution: riskDist as any[],
        recentActivity: recent as any[],
      };
    }),
    exportAlerts: protectedProcedure.input(z.object({ format: z.enum(["json","csv"]).default("json") })).query(async () => {
      const db = await getDb(); if (!db) return { data: [] };
      const [rows] = await db.execute(sql.raw(`SELECT fa.*, u.name as user_name, u.email as user_email FROM fraud_alerts fa LEFT JOIN users u ON fa.user_id = u.id ORDER BY fa.created_at DESC`));
      return { data: rows as any[], exportedAt: new Date() };
    }),
  }),

  // ─── ENHANCED RECURRING PAYMENTS SCHEDULER ────────────────────────────────
  scheduler: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb(); if (!db) return { payments: [], executions: [] };
      const [payments] = await db.execute(sql.raw(`SELECT * FROM recurring_payments WHERE user_id = ${ctx.user.id} ORDER BY created_at DESC`));
      const [executions] = await db.execute(sql.raw(`SELECT * FROM recurring_payment_executions WHERE user_id = ${ctx.user.id} ORDER BY executed_at DESC LIMIT 20`));
      return { payments: payments as any[], executions: executions as any[] };
    }),
    create: protectedProcedure.input(z.object({
      recipientName: z.string(),
      recipientAccount: z.string(),
      recipientBank: z.string(),
      amount: z.number().positive(),
      currency: z.string().default("NGN"),
      frequency: z.enum(["daily","weekly","monthly","quarterly"]),
      startDate: z.string(),
      endDate: z.string().optional(),
      description: z.string().optional(),
      dayOfWeek: z.number().min(0).max(6).optional(),
      dayOfMonth: z.number().min(1).max(31).optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const nextRun = calculateNextRun(input.frequency, input.startDate, input.dayOfWeek, input.dayOfMonth);
      const nextRunStr = nextRun.toISOString().slice(0, 19).replace("T", " ");
      const endDateStr = input.endDate ? db.escape(input.endDate) : "NULL";
      await db.execute(sql.raw(`INSERT INTO recurring_payments (user_id, recipient_name, recipient_account, recipient_bank, amount, currency, frequency, start_date, end_date, next_run, status, description) VALUES (${ctx.user.id}, ${db.escape(input.recipientName)}, ${db.escape(input.recipientAccount)}, ${db.escape(input.recipientBank)}, ${input.amount}, ${db.escape(input.currency)}, ${db.escape(input.frequency)}, ${db.escape(input.startDate)}, ${endDateStr}, ${db.escape(nextRunStr)}, 'active', ${db.escape(input.description ?? "")})`));
      await createAuditLog({ userId: ctx.user.id, action: "RECURRING_PAYMENT_CREATED", description: `Created ${input.frequency} payment of ${input.amount} ${input.currency} to ${input.recipientName}` });
      return { success: true };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      amount: z.number().positive().optional(),
      frequency: z.enum(["daily","weekly","monthly","quarterly"]).optional(),
      status: z.enum(["active","paused","cancelled"]).optional(),
      endDate: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: string[] = [];
      if (input.amount !== undefined) updates.push(`amount = ${input.amount}`);
      if (input.frequency !== undefined) updates.push(`frequency = ${db.escape(input.frequency)}`);
      if (input.status !== undefined) updates.push(`status = ${db.escape(input.status)}`);
      if (input.endDate !== undefined) updates.push(`end_date = ${db.escape(input.endDate)}`);
      if (updates.length > 0) {
        await db.execute(sql.raw(`UPDATE recurring_payments SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      }
      return { success: true };
    }),
    pause: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql.raw(`UPDATE recurring_payments SET status = 'paused', updated_at = NOW() WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      return { success: true };
    }),
    resume: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql.raw(`UPDATE recurring_payments SET status = 'active', updated_at = NOW() WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      return { success: true };
    }),
    cancel: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql.raw(`UPDATE recurring_payments SET status = 'cancelled', updated_at = NOW() WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      await createAuditLog({ userId: ctx.user.id, action: "RECURRING_PAYMENT_CANCELLED", description: `Cancelled recurring payment #${input.id}` });
      return { success: true };
    }),
    executions: protectedProcedure.input(z.object({ paymentId: z.number() })).query(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) return [];
      const [rows] = await db.execute(sql.raw(`SELECT * FROM recurring_payment_executions WHERE recurring_payment_id = ${input.paymentId} AND user_id = ${ctx.user.id} ORDER BY executed_at DESC LIMIT 50`));
      return rows as any[];
    }),
  }),

  // ─── FX RATE ALERT SYSTEM ─────────────────────────────────────────────────
  rateAlerts: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb(); if (!db) return [];
      const [rows] = await db.execute(sql.raw(`SELECT * FROM fx_rate_alert_targets WHERE user_id = ${ctx.user.id} ORDER BY created_at DESC`));
      return rows as any[];
    }),
    create: protectedProcedure.input(z.object({
      fromCurrency: z.string(),
      toCurrency: z.string(),
      targetRate: z.number().positive(),
      direction: z.enum(["above","below"]),
      notifySms: z.boolean().default(true),
      notifyEmail: z.boolean().default(true),
      notifyPush: z.boolean().default(true),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql.raw(`INSERT INTO fx_rate_alert_targets (user_id, from_currency, to_currency, target_rate, direction, is_active, notify_sms, notify_email, notify_push) VALUES (${ctx.user.id}, ${db.escape(input.fromCurrency)}, ${db.escape(input.toCurrency)}, ${input.targetRate}, ${db.escape(input.direction)}, 1, ${input.notifySms ? 1 : 0}, ${input.notifyEmail ? 1 : 0}, ${input.notifyPush ? 1 : 0})`));
      await createAuditLog({ userId: ctx.user.id, action: "FX_ALERT_CREATED", description: `Created FX alert: ${input.fromCurrency}/${input.toCurrency} ${input.direction} ${input.targetRate}` });
      return { success: true };
    }),
    update: protectedProcedure.input(z.object({
      id: z.number(),
      targetRate: z.number().positive().optional(),
      direction: z.enum(["above","below"]).optional(),
      isActive: z.boolean().optional(),
      notifySms: z.boolean().optional(),
      notifyEmail: z.boolean().optional(),
      notifyPush: z.boolean().optional(),
    })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: string[] = [];
      if (input.targetRate !== undefined) updates.push(`target_rate = ${input.targetRate}`);
      if (input.direction !== undefined) updates.push(`direction = ${db.escape(input.direction)}`);
      if (input.isActive !== undefined) updates.push(`is_active = ${input.isActive ? 1 : 0}`);
      if (input.notifySms !== undefined) updates.push(`notify_sms = ${input.notifySms ? 1 : 0}`);
      if (input.notifyEmail !== undefined) updates.push(`notify_email = ${input.notifyEmail ? 1 : 0}`);
      if (input.notifyPush !== undefined) updates.push(`notify_push = ${input.notifyPush ? 1 : 0}`);
      if (updates.length > 0) {
        await db.execute(sql.raw(`UPDATE fx_rate_alert_targets SET ${updates.join(", ")}, updated_at = NOW() WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      }
      return { success: true };
    }),
    remove: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      const db = await getDb(); if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      await db.execute(sql.raw(`DELETE FROM fx_rate_alert_targets WHERE id = ${input.id} AND user_id = ${ctx.user.id}`));
      return { success: true };
    }),
    checkNow: protectedProcedure.query(async ({ ctx }) => {
      const db = await getDb(); if (!db) return { checked: 0, triggered: 0, rates: {} };
      const [alerts] = await db.execute(sql.raw(`SELECT * FROM fx_rate_alert_targets WHERE user_id = ${ctx.user.id} AND is_active = 1`));
      const rates = await getLiveRates("USD");
      let triggered = 0;
      for (const alert of alerts as any[]) {
        const fromRate = rates[alert.from_currency] ?? 1;
        const toRate = rates[alert.to_currency] ?? 1;
        const currentRate = toRate / fromRate;
        const targetRate = Number(alert.target_rate);
        const isTriggered = alert.direction === "above" ? currentRate >= targetRate : currentRate <= targetRate;
        if (isTriggered) {
          triggered++;
          await db.execute(sql.raw(`UPDATE fx_rate_alert_targets SET triggered_at = NOW(), trigger_count = trigger_count + 1 WHERE id = ${alert.id}`));
        }
      }
      return { checked: (alerts as any[]).length, triggered, rates: Object.fromEntries(Object.entries(rates).slice(0, 20)) };
    }),
    currentRates: publicProcedure.input(z.object({ pairs: z.array(z.string()).optional() })).query(async ({ input }) => {
      const rates = await getLiveRates("USD");
      const pairs = input.pairs ?? ["USD/NGN","GBP/NGN","EUR/NGN","USD/KES","USD/GHS","USD/ZAR","USD/GBP","USD/EUR"];
      return pairs.map(pair => {
        const [from, to] = pair.split("/");
        const fromRate = rates[from] ?? 1;
        const toRate = rates[to] ?? 1;
        const rate = toRate / fromRate;
        const change = (Math.random() * 2 - 1).toFixed(4);
        return { pair, from, to, rate, change, trend: Number(change) > 0 ? "up" : "down", lastUpdated: new Date() };
      });
    }),
  }),
'''

# Replace the closing bracket pattern
old_end = '});\n\nexport type AppRouter = typeof appRouter;'
new_end = new_routers + '});\n\nexport type AppRouter = typeof appRouter;'

if old_end in content:
    content = content.replace(old_end, new_end)
    print("Replacement successful!")
else:
    print("Pattern not found, trying alternate...")
    # Try without double newline
    old_end2 = '});\nexport type AppRouter = typeof appRouter;'
    new_end2 = new_routers + '});\nexport type AppRouter = typeof appRouter;'
    if old_end2 in content:
        content = content.replace(old_end2, new_end2)
        print("Alternate replacement successful!")
    else:
        print("ERROR: Could not find closing pattern")
        print(repr(content[-100:]))

with open('server/routers.ts', 'w') as f:
    f.write(content)

print(f"New line count: {len(content.splitlines())}")
