package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	_ "github.com/lib/pq"
)

// ═══════════════════════════════════════════════════════════════════════════════
// RemitFlow Unified Failure Monitor Service (Go)
//
// Scheduled job running every 30 minutes to detect and handle failures across
// all money-moving features:
//
//   1. BNPL: Mark overdue installments, apply late fees, escalate to collections
//   2. Transfers: Detect stuck transfers (>48h), auto-refund after 7 days
//   3. Mortgage: Detect missed repayments, escalate foreclosure warnings
//   4. Split Bills: Process expired payment deadlines
//   5. Bonds: Detect missed coupon payments
//
// Language: Go (chosen for reliable, long-running background job with
//   minimal memory footprint and strong concurrency)
//
// Port: 8097
// ═══════════════════════════════════════════════════════════════════════════════

// Configuration loaded from environment variables
var _processStartTime = time.Now()

type Config struct {
	Port                string
	ScanIntervalMinutes int
	BnplLateFeeRate     float64
	CollectionDaysThreshold int
	StuckTransferHours  int
	AutoRefundDays      int
	ForeclosureMissCount int
	BondCouponWindowDays int
}

func loadConfig() *Config {
	c := &Config{
		Port:                envOrDefault("PORT", "8097"),
		ScanIntervalMinutes: envOrDefaultInt("SCAN_INTERVAL_MINUTES", 30),
		BnplLateFeeRate:     envOrDefaultFloat("BNPL_LATE_FEE_RATE", 0.02),
		CollectionDaysThreshold: envOrDefaultInt("COLLECTION_DAYS_THRESHOLD", 7),
		StuckTransferHours:  envOrDefaultInt("STUCK_TRANSFER_HOURS", 48),
		AutoRefundDays:      envOrDefaultInt("AUTO_REFUND_DAYS", 7),
		ForeclosureMissCount: envOrDefaultInt("FORECLOSURE_MISS_COUNT", 3),
		BondCouponWindowDays: envOrDefaultInt("BOND_COUPON_WINDOW_DAYS", 30),
	}
	return c
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envOrDefaultInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	parsed := def
	fmt.Sscanf(v, "%d", &parsed)
	return parsed
}

func envOrDefaultFloat(key string, def float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	parsed := def
	fmt.Sscanf(v, "%f", &parsed)
	return parsed
}

type Metrics struct {
	mu                    sync.Mutex
	TotalScans            int64     `json:"totalScans"`
	BnplOverdueMarked     int64     `json:"bnplOverdueMarked"`
	BnplLateFeesApplied   int64     `json:"bnplLateFeesApplied"`
	BnplCollections       int64     `json:"bnplCollectionsEscalated"`
	StuckTransfers        int64     `json:"stuckTransfersDetected"`
	TransferAutoRefunds   int64     `json:"transferAutoRefunds"`
	MortgageOverdue       int64     `json:"mortgageOverduePayments"`
	MortgageForeclosure   int64     `json:"mortgageForeclosureWarnings"`
	SplitBillExpired      int64     `json:"splitBillExpiredDeadlines"`
	BondMissedCoupons     int64     `json:"bondMissedCoupons"`
	LastScanAt            time.Time `json:"lastScanAt"`
	LastScanDurationMs    int64     `json:"lastScanDurationMs"`
	Errors                int64     `json:"errors"`
}

type FailureMonitor struct {
	db        *sql.DB
	metrics   *Metrics
	config    *Config
	startTime time.Time
}

// ─── 1. BNPL Overdue Detection ──────────────────────────────────────────────

func (m *FailureMonitor) scanBnplOverdue(ctx context.Context) (int, int, error) {
	// Mark pending installments as overdue
	result, err := m.db.ExecContext(ctx, `
		UPDATE bnpl_installments
		SET status = 'overdue', updated_at = NOW()
		WHERE status = 'pending'
		  AND due_date < NOW()
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("mark overdue: %w", err)
	}
	overdueCount, _ := result.RowsAffected()

	// Apply late fees (2% penalty)
	rows, err := m.db.QueryContext(ctx, `
		SELECT bi.id, bi.plan_id, bi.user_id, bi.amount_ngn
		FROM bnpl_installments bi
		WHERE bi.status = 'overdue'
		  AND NOT EXISTS (SELECT 1 FROM bnpl_late_fees lf WHERE lf.installment_id = bi.id)
	`)
	if err != nil {
		return int(overdueCount), 0, fmt.Errorf("query for late fees: %w", err)
	}
	defer rows.Close()

	lateFeesApplied := 0
	for rows.Next() {
		var id, planId, userId int
		var amountNgn float64
		if err := rows.Scan(&id, &planId, &userId, &amountNgn); err != nil {
			continue
		}
		lateFee := amountNgn * m.config.BnplLateFeeRate
		_, err := m.db.ExecContext(ctx, `
			INSERT INTO bnpl_late_fees (installment_id, plan_id, user_id, fee_amount_ngn, reason, created_at)
			VALUES ($1, $2, $3, $4, 'overdue_penalty', NOW())
			ON CONFLICT DO NOTHING
		`, id, planId, userId, lateFee)
		if err == nil {
			lateFeesApplied++
			// Notify user
			m.notify(ctx, userId, "bnpl_overdue", fmt.Sprintf(
				"Your BNPL installment is overdue. A late fee of ₦%.2f has been applied. Pay immediately to avoid collection escalation.", lateFee))
		}
	}

	log.Printf("[BNPL] Overdue: %d, Late fees applied: %d", overdueCount, lateFeesApplied)
	return int(overdueCount), lateFeesApplied, nil
}

func (m *FailureMonitor) escalateBnplCollections(ctx context.Context) (int, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT bi.id, bi.plan_id, bi.user_id,
		       EXTRACT(DAY FROM (NOW() - bi.due_date)) as days_overdue
		FROM bnpl_installments bi
		WHERE bi.status = 'overdue'
		  AND bi.due_date < NOW() - INTERVAL '` + fmt.Sprintf("%d", m.config.CollectionDaysThreshold) + ` days'
		  AND NOT EXISTS (SELECT 1 FROM bnpl_collections WHERE installment_id = bi.id)
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id, planId, userId int
		var daysOverdue float64
		if err := rows.Scan(&id, &planId, &userId, &daysOverdue); err != nil {
			continue
		}
		level := "internal"
		if daysOverdue > 30 {
			level = "legal"
		} else if daysOverdue > 14 {
			level = "agency"
		}
		_, err := m.db.ExecContext(ctx, `
			INSERT INTO bnpl_collections (installment_id, plan_id, user_id, status, escalation_level, created_at)
			VALUES ($1, $2, $3, 'active', $4, NOW())
		`, id, planId, userId, level)
		if err == nil {
			count++
			m.notify(ctx, userId, "bnpl_collection", fmt.Sprintf(
				"URGENT: Your BNPL payment is %.0f days overdue. Escalated to %s collections.", daysOverdue, level))
		}
	}
	log.Printf("[BNPL] Collections escalated: %d", count)
	return count, nil
}

// ─── 2. Stuck Transfer Detection ────────────────────────────────────────────

func (m *FailureMonitor) scanStuckTransfers(ctx context.Context) (int, error) {
	result, err := m.db.ExecContext(ctx, `
		UPDATE transactions
		SET status = 'stuck', "updatedAt" = NOW()
		WHERE status = 'processing'
		  AND "updatedAt" < NOW() - INTERVAL '` + fmt.Sprintf("%d", m.config.StuckTransferHours) + ` hours'
	`)
	if err != nil {
		return 0, err
	}
	count, _ := result.RowsAffected()

	// Notify affected users
	if count > 0 {
		rows, err := m.db.QueryContext(ctx, `
			SELECT "userId", reference, amount, from_currency FROM transactions WHERE status = 'stuck' AND "updatedAt" > NOW() - INTERVAL '1 hour'
		`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var userId int
				var ref, amount, currency string
				if err := rows.Scan(&userId, &ref, &amount, &currency); err != nil {
					continue
				}
				m.notify(ctx, userId, "transfer_stuck", fmt.Sprintf(
					"Your transfer of %s %s (ref: %s) is stuck. If not resolved in 5 business days, you'll receive an automatic refund.", amount, currency, ref))
			}
		}
	}

	log.Printf("[TRANSFER] Stuck detected: %d", count)
	return int(count), nil
}

func (m *FailureMonitor) autoRefundStuck(ctx context.Context) (int, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT id, "userId", amount, from_currency, reference
		FROM transactions
		WHERE status = 'stuck'
		  AND "updatedAt" < NOW() - INTERVAL '` + fmt.Sprintf("%d", m.config.AutoRefundDays) + ` days'
		LIMIT 100
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var txId, userId int
		var amount, currency, ref string
		if err := rows.Scan(&txId, &userId, &amount, &currency, &ref); err != nil {
			continue
		}
		tx, err := m.db.BeginTx(ctx, nil)
		if err != nil {
			continue
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE wallets SET balance = CAST(CAST(balance AS DECIMAL(18,4)) + CAST($1 AS DECIMAL(18,4)) AS VARCHAR), "updatedAt" = NOW()
			WHERE "userId" = $2 AND currency = $3
		`, amount, userId, currency)
		if err != nil {
			tx.Rollback()
			continue
		}
		_, err = tx.ExecContext(ctx, `UPDATE transactions SET status = 'refunded', "updatedAt" = NOW() WHERE id = $1`, txId)
		if err != nil {
			tx.Rollback()
			continue
		}
		_, _ = tx.ExecContext(ctx, `
			INSERT INTO transactions ("userId", type, status, amount, from_currency, to_currency, description, reference, "createdAt", "updatedAt")
			VALUES ($1, 'refund', 'completed', $2, $3, $3, 'Auto-refund: transfer stuck beyond SLA', 'AUTOREFUND-' || $4, NOW(), NOW())
		`, userId, amount, currency, ref)
		if err := tx.Commit(); err != nil {
			continue
		}
		m.notify(ctx, userId, "auto_refund", fmt.Sprintf(
			"Your stuck transfer (ref: %s) has been automatically refunded. %s %s returned to your wallet.", ref, amount, currency))
		count++
	}

	log.Printf("[TRANSFER] Auto-refunded: %d", count)
	return count, nil
}

// ─── 3. Mortgage Missed Payments ────────────────────────────────────────────

func (m *FailureMonitor) scanMortgageOverdue(ctx context.Context) (int, int, error) {
	result, err := m.db.ExecContext(ctx, `
		UPDATE mortgage_repayments
		SET status = 'overdue'
		WHERE status = 'scheduled'
		  AND due_date < NOW()
	`)
	if err != nil {
		return 0, 0, err
	}
	overdueCount, _ := result.RowsAffected()

	// Check for 3+ consecutive misses → foreclosure warning
	rows, err := m.db.QueryContext(ctx, `
		SELECT mr.application_id, COUNT(*) as miss_count, ma.applicant_id
		FROM mortgage_repayments mr
		JOIN mortgage_applications ma ON ma.id = mr.application_id
		WHERE mr.status = 'overdue'
		  AND ma.status = 'active'
		GROUP BY mr.application_id, ma.applicant_id
		HAVING COUNT(*) >= ` + fmt.Sprintf("%d", m.config.ForeclosureMissCount) + `
	`)
	if err != nil {
		return int(overdueCount), 0, err
	}
	defer rows.Close()

	foreclosures := 0
	for rows.Next() {
		var appId, missCount, applicantId int
		if err := rows.Scan(&appId, &missCount, &applicantId); err != nil {
			continue
		}
		_, _ = m.db.ExecContext(ctx, `
			UPDATE mortgage_applications SET status = 'foreclosure_warning', updated_at = NOW()
			WHERE id = $1 AND status = 'active'
		`, appId)
		m.notify(ctx, applicantId, "mortgage_foreclosure_warning", fmt.Sprintf(
			"CRITICAL: You have missed %d consecutive mortgage payments. Foreclosure proceedings will begin in 30 days unless all arrears are cleared.", missCount))
		foreclosures++
	}

	log.Printf("[MORTGAGE] Overdue: %d, Foreclosure warnings: %d", overdueCount, foreclosures)
	return int(overdueCount), foreclosures, nil
}

// ─── 4. Split Bill Expired Deadlines ────────────────────────────────────────

func (m *FailureMonitor) scanSplitBillExpired(ctx context.Context) (int, error) {
	rows, err := m.db.QueryContext(ctx, `
		SELECT sbp.id, sbp.bill_id, sbp.user_id, sbp.amount, sb.creator_id
		FROM split_bill_participants sbp
		JOIN split_bills sb ON sb.id = sbp.bill_id
		WHERE sbp.status = 'pending'
		  AND sbp.payment_deadline IS NOT NULL
		  AND sbp.payment_deadline < NOW()
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var id, billId, userId, creatorId int
		var amount float64
		if err := rows.Scan(&id, &billId, &userId, &amount, &creatorId); err != nil {
			continue
		}
		_, _ = m.db.ExecContext(ctx, `
			UPDATE split_bill_participants SET status = 'defaulted', updated_at = NOW() WHERE id = $1
		`, id)
		m.notify(ctx, userId, "split_bill_expired", fmt.Sprintf(
			"You missed the payment deadline for a split bill (₦%.2f). Marked as defaulted.", amount))
		m.notify(ctx, creatorId, "split_bill_participant_defaulted", fmt.Sprintf(
			"A participant missed their split bill deadline (₦%.2f). You may redistribute their share.", amount))
		count++
	}

	log.Printf("[SPLIT_BILL] Expired deadlines: %d", count)
	return count, nil
}

// ─── 5. Bond Missed Coupon Detection ────────────────────────────────────────

func (m *FailureMonitor) scanBondMissedCoupons(ctx context.Context) (int, error) {
	// Check for bonds with active subscriptions where coupon_payment_date has passed
	// and no coupon was distributed
	rows, err := m.db.QueryContext(ctx, `
		SELECT db.id, db.name, db.coupon_rate,
		       COUNT(bs.id) as holder_count
		FROM diaspora_bonds db
		JOIN bond_subscriptions bs ON bs.bond_id = db.id AND bs.status = 'active'
		WHERE db.status = 'active'
		  AND db.next_coupon_date < NOW()
		  AND NOT EXISTS (
		    SELECT 1 FROM bond_default_events bde
		    WHERE bde.bond_id = db.id AND bde.created_at > NOW() - INTERVAL '` + fmt.Sprintf("%d", m.config.BondCouponWindowDays) + ` days'
		  )
		GROUP BY db.id, db.name, db.coupon_rate
	`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var bondId, holderCount int
		var name string
		var couponRate float64
		if err := rows.Scan(&bondId, &name, &couponRate, &holderCount); err != nil {
			continue
		}
		// Create incident
		incidentId := fmt.Sprintf("BOND-MC-%d-%d", bondId, time.Now().Unix())
		_, _ = m.db.ExecContext(ctx, `
			INSERT INTO bond_default_events (incident_id, bond_id, event_type, coupon_period, affected_holders, status, created_at)
			VALUES ($1, $2, 'missed_coupon', 'auto-detected', $3, 'open', NOW())
		`, incidentId, bondId, holderCount)

		log.Printf("[BOND] Missed coupon detected for bond %d (%s), %d holders affected", bondId, name, holderCount)
		count++
	}

	return count, nil
}

// ─── Helpers ────────────────────────────────────────────────────────────────

func (m *FailureMonitor) notify(ctx context.Context, userId int, notifType, message string) {
	_, err := m.db.ExecContext(ctx, `
		INSERT INTO notifications ("userId", type, message, "createdAt")
		VALUES ($1, $2, $3, NOW())
	`, userId, notifType, message)
	if err != nil {
		log.Printf("[WARN] notification insert failed for user %d: %v", userId, err)
	}
}

// ─── Main Scan Loop ─────────────────────────────────────────────────────────

func (m *FailureMonitor) runScan(ctx context.Context) {
	start := time.Now()
	log.Println("[SCAN] Starting unified failure protection scan...")

	bnplOverdue, bnplFees, err1 := m.scanBnplOverdue(ctx)
	bnplCollections, err2 := m.escalateBnplCollections(ctx)
	stuckTransfers, err3 := m.scanStuckTransfers(ctx)
	autoRefunds, err4 := m.autoRefundStuck(ctx)
	mortgageOverdue, mortgageForeclosure, err5 := m.scanMortgageOverdue(ctx)
	splitBillExpired, err6 := m.scanSplitBillExpired(ctx)
	bondMissed, err7 := m.scanBondMissedCoupons(ctx)

	duration := time.Since(start)

	m.metrics.mu.Lock()
	m.metrics.TotalScans++
	m.metrics.BnplOverdueMarked += int64(bnplOverdue)
	m.metrics.BnplLateFeesApplied += int64(bnplFees)
	m.metrics.BnplCollections += int64(bnplCollections)
	m.metrics.StuckTransfers += int64(stuckTransfers)
	m.metrics.TransferAutoRefunds += int64(autoRefunds)
	m.metrics.MortgageOverdue += int64(mortgageOverdue)
	m.metrics.MortgageForeclosure += int64(mortgageForeclosure)
	m.metrics.SplitBillExpired += int64(splitBillExpired)
	m.metrics.BondMissedCoupons += int64(bondMissed)
	m.metrics.LastScanAt = time.Now()
	m.metrics.LastScanDurationMs = duration.Milliseconds()
	m.metrics.mu.Unlock()

	log.Printf("[SCAN] Complete in %dms — BNPL(overdue:%d, fees:%d, collections:%d) TRANSFER(stuck:%d, refunded:%d) MORTGAGE(overdue:%d, foreclosure:%d) SPLIT(%d) BOND(%d)",
		duration.Milliseconds(), bnplOverdue, bnplFees, bnplCollections, stuckTransfers, autoRefunds, mortgageOverdue, mortgageForeclosure, splitBillExpired, bondMissed)

	for _, err := range []error{err1, err2, err3, err4, err5, err6, err7} {
		if err != nil {
			log.Printf("[SCAN_ERROR] %v", err)
			m.metrics.mu.Lock()
			m.metrics.Errors++
			m.metrics.mu.Unlock()
		}
	}
}

// ─── HTTP Server ────────────────────────────────────────────────────────────

func (m *FailureMonitor) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "go-failure-monitor",
		"uptime":  time.Since(m.startTime).String(),
	})
}

func (m *FailureMonitor) readinessHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := m.db.PingContext(ctx); err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status": "not_ready",
			"error":  err.Error(),
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "ready",
		"database": "connected",
	})
}

func (m *FailureMonitor) metricsHandler(w http.ResponseWriter, r *http.Request) {
	m.metrics.mu.Lock()
	defer m.metrics.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m.metrics)
}

func (m *FailureMonitor) triggerScanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	go m.runScan(context.Background())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "scan_triggered"})
}

func main() {
	cfg := loadConfig()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://remitflow:remitflow@localhost:5432/remitflow?sslmode=disable"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Failed to connect to DB: %v", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(5)
	db.SetMaxIdleConns(2)
	db.SetConnMaxLifetime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		log.Printf("[WARN] DB ping failed (will retry on scan): %v", err)
	}

	monitor := &FailureMonitor{
		db:        db,
		metrics:   &Metrics{},
		config:    cfg,
		startTime: time.Now(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		monitor.runScan(ctx)
		ticker := time.NewTicker(time.Duration(cfg.ScanIntervalMinutes) * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				monitor.runScan(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", monitor.healthHandler)
	mux.HandleFunc("/readiness", monitor.readinessHandler)
	mux.HandleFunc("/metrics", monitor.metricsHandler)
	mux.HandleFunc("/scan", monitor.triggerScanHandler)

	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[SHUTDOWN] Shutting down failure monitor...")
		cancel()
		srv.Shutdown(context.Background())
	}()

	log.Printf("[START] Unified Failure Monitor listening on :%s (scan every %d min)", cfg.Port, cfg.ScanIntervalMinutes)
	fmt.Fprintf(os.Stderr, "{\"event\":\"pod.startup.complete\",\"service\":\"%s\",\"startup_ms\":%d,\"timestamp\":\"%s\"}\n", "go-failure-monitor", time.Since(_processStartTime).Milliseconds(), time.Now().Format(time.RFC3339))
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)

	}
}
