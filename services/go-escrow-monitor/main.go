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
// RemitFlow Property Escrow Deadline Monitor Service (Go)
//
// Scheduled job that runs every hour to:
//   1. Scan for overdue milestones → send 14-day cure notices
//   2. Check expired cure notices → mark milestones as defaulted
//   3. Process auto-refunds after 90-day grace period
//   4. Detect stale escrow plans with no activity for 60+ days
//
// Language: Go (chosen for reliable, long-running background job with
//   minimal memory footprint, strong concurrency, and DB connection pooling)
//
// Port: 8095
// ═══════════════════════════════════════════════════════════════════════════════

const (
	defaultPort          = "8095"
	cureNoticeDays       = 14
	gracePeriodDays      = 90
	stalePlanDays        = 60
	scanIntervalMinutes  = 60
)

type Metrics struct {
	mu                   sync.Mutex
	TotalScans           int64     `json:"totalScans"`
	OverdueMilestones    int64     `json:"overdueMilestonesDetected"`
	CureNoticesSent      int64     `json:"cureNoticesSent"`
	CureNoticesExpired   int64     `json:"cureNoticesExpired"`
	AutoRefundsTriggered int64     `json:"autoRefundsTriggered"`
	StalePlansDetected   int64     `json:"stalePlansDetected"`
	LastScanAt           time.Time `json:"lastScanAt"`
	LastScanDurationMs   int64     `json:"lastScanDurationMs"`
	Errors               int64     `json:"errors"`
}

type EscrowMonitor struct {
	db      *sql.DB
	metrics *Metrics
}

// ─── Overdue Milestone Detection ─────────────────────────────────────────────

type OverdueMilestone struct {
	MilestoneID  string
	PlanID       string
	BuyerID      int
	BuilderID    int
	Name         string
	Deadline     time.Time
	Status       string
}

func (m *EscrowMonitor) scanOverdueMilestones(ctx context.Context) (int, error) {
	query := `
		SELECT pm.milestone_id, pep.plan_id, pep.buyer_id, pep.builder_id, pm.name, pm.deadline, pm.status
		FROM property_milestones pm
		JOIN property_escrow_plans pep ON pm.escrow_plan_id = pep.id
		WHERE pm.status IN ('pending', 'in_progress', 'evidence_submitted')
		  AND pm.deadline < NOW()
		  AND pm.cure_notice_sent_at IS NULL
		  AND pep.status = 'active'
		ORDER BY pm.deadline ASC
		LIMIT 500
	`
	rows, err := m.db.QueryContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("query overdue milestones: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var ms OverdueMilestone
		if err := rows.Scan(&ms.MilestoneID, &ms.PlanID, &ms.BuyerID, &ms.BuilderID, &ms.Name, &ms.Deadline, &ms.Status); err != nil {
			log.Printf("[WARN] scan row: %v", err)
			continue
		}
		if err := m.sendCureNotice(ctx, ms); err != nil {
			log.Printf("[ERROR] cure notice for %s: %v", ms.MilestoneID, err)
			m.metrics.mu.Lock()
			m.metrics.Errors++
			m.metrics.mu.Unlock()
			continue
		}
		count++
	}
	return count, rows.Err()
}

func (m *EscrowMonitor) sendCureNotice(ctx context.Context, ms OverdueMilestone) error {
	cureExpiry := time.Now().Add(time.Duration(cureNoticeDays) * 24 * time.Hour)

	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Update milestone with cure notice
	_, err = tx.ExecContext(ctx, `
		UPDATE property_milestones
		SET status = 'cure_notice',
		    cure_notice_sent_at = NOW(),
		    cure_notice_expires_at = $1,
		    updated_at = NOW()
		WHERE milestone_id = $2
	`, cureExpiry, ms.MilestoneID)
	if err != nil {
		return fmt.Errorf("update milestone: %w", err)
	}

	// Create audit log
	_, err = tx.ExecContext(ctx, `
		INSERT INTO audit_logs ("userId", action, metadata, "createdAt")
		VALUES ($1, 'CURE_NOTICE_SENT', $2::jsonb, NOW())
	`, ms.BuyerID, fmt.Sprintf(`{"milestoneId":"%s","planId":"%s","cureExpiry":"%s","builderNotified":true}`,
		ms.MilestoneID, ms.PlanID, cureExpiry.Format(time.RFC3339)))
	if err != nil {
		return fmt.Errorf("audit log: %w", err)
	}

	// Insert notification for builder
	_, err = tx.ExecContext(ctx, `
		INSERT INTO notifications ("userId", type, message, "createdAt")
		VALUES (
			(SELECT user_id FROM builder_profiles WHERE id = $1),
			'cure_notice',
			$2,
			NOW()
		)
	`, ms.BuilderID, fmt.Sprintf(
		"CURE NOTICE: Milestone \"%s\" for plan %s is overdue (deadline: %s). "+
			"You have %d days to submit evidence and resolve this. "+
			"Failure to comply may result in funds being frozen and refunded to the buyer.",
		ms.Name, ms.PlanID, ms.Deadline.Format("2006-01-02"), cureNoticeDays))
	if err != nil {
		log.Printf("[WARN] notification insert: %v", err)
		// Non-fatal: notification failure shouldn't block the cure notice
	}

	// Insert notification for buyer
	_, _ = tx.ExecContext(ctx, `
		INSERT INTO notifications ("userId", type, message, "createdAt")
		VALUES ($1, 'cure_notice', $2, NOW())
	`, ms.BuyerID, fmt.Sprintf(
		"A cure notice has been sent to your builder for milestone \"%s\" (plan %s). "+
			"The builder has %d days to respond. If unresolved, you may request a refund after the %d-day grace period.",
		ms.Name, ms.PlanID, cureNoticeDays, gracePeriodDays))

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	m.metrics.mu.Lock()
	m.metrics.CureNoticesSent++
	m.metrics.mu.Unlock()

	log.Printf("[CURE_NOTICE] Sent for milestone %s (plan %s, builder %d, deadline %s, expires %s)",
		ms.MilestoneID, ms.PlanID, ms.BuilderID, ms.Deadline.Format("2006-01-02"), cureExpiry.Format("2006-01-02"))
	return nil
}

// ─── Expired Cure Notice Detection ───────────────────────────────────────────

func (m *EscrowMonitor) scanExpiredCureNotices(ctx context.Context) (int, error) {
	query := `
		UPDATE property_milestones
		SET status = 'defaulted', updated_at = NOW()
		WHERE status = 'cure_notice'
		  AND cure_notice_expires_at < NOW()
		RETURNING milestone_id, escrow_plan_id
	`
	rows, err := m.db.QueryContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("expire cure notices: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var milestoneID string
		var planDBID int
		if err := rows.Scan(&milestoneID, &planDBID); err != nil {
			continue
		}

		// Mark the escrow plan as defaulted if any milestone defaults
		_, _ = m.db.ExecContext(ctx, `
			UPDATE property_escrow_plans
			SET status = 'defaulted', updated_at = NOW()
			WHERE id = $1 AND status = 'active'
		`, planDBID)

		log.Printf("[CURE_EXPIRED] Milestone %s defaulted (plan DB ID %d)", milestoneID, planDBID)
		count++
	}

	m.metrics.mu.Lock()
	m.metrics.CureNoticesExpired += int64(count)
	m.metrics.mu.Unlock()

	return count, rows.Err()
}

// ─── Auto-Refund Processing ─────────────────────────────────────────────────

func (m *EscrowMonitor) processAutoRefunds(ctx context.Context) (int, error) {
	query := `
		SELECT ped.dispute_id, ped.escrow_plan_id, pep.plan_id, pep.buyer_id,
		       pep.total_paid_usd, pep.total_released_usd
		FROM property_escrow_disputes ped
		JOIN property_escrow_plans pep ON ped.escrow_plan_id = pep.id
		WHERE ped.auto_refund_date IS NOT NULL
		  AND ped.auto_refund_date <= NOW()
		  AND ped.status NOT IN ('refund_completed', 'resolved_buyer', 'resolved_builder', 'closed')
		  AND pep.status IN ('disputed', 'defaulted')
		LIMIT 100
	`
	rows, err := m.db.QueryContext(ctx, query)
	if err != nil {
		return 0, fmt.Errorf("query auto refunds: %w", err)
	}
	defer rows.Close()

	type refundCase struct {
		DisputeID    string
		EscrowPlanDBID int
		PlanID       string
		BuyerID      int
		TotalPaid    float64
		TotalReleased float64
	}
	var cases []refundCase
	for rows.Next() {
		var c refundCase
		if err := rows.Scan(&c.DisputeID, &c.EscrowPlanDBID, &c.PlanID, &c.BuyerID, &c.TotalPaid, &c.TotalReleased); err != nil {
			continue
		}
		cases = append(cases, c)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	count := 0
	for _, c := range cases {
		refundAmount := c.TotalPaid - c.TotalReleased
		if refundAmount <= 0 {
			continue
		}
		if err := m.executeAutoRefund(ctx, c.DisputeID, c.EscrowPlanDBID, c.PlanID, c.BuyerID, refundAmount); err != nil {
			log.Printf("[ERROR] auto refund for dispute %s: %v", c.DisputeID, err)
			m.metrics.mu.Lock()
			m.metrics.Errors++
			m.metrics.mu.Unlock()
			continue
		}
		count++
	}
	return count, nil
}

func (m *EscrowMonitor) executeAutoRefund(ctx context.Context, disputeID string, planDBID int, planID string, buyerID int, amount float64) error {
	tx, err := m.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Credit buyer's wallet
	_, err = tx.ExecContext(ctx, `
		UPDATE wallets
		SET balance = balance + $1, "updatedAt" = NOW()
		WHERE "userId" = $2 AND currency = 'USD'
	`, amount, buyerID)
	if err != nil {
		return fmt.Errorf("credit wallet: %w", err)
	}

	// Record refund transaction
	refRef := fmt.Sprintf("AUTO-REFUND-%s", disputeID)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO transactions ("userId", type, status, from_amount, from_currency, to_amount, to_currency, description, reference, "createdAt", "updatedAt")
		VALUES ($1, 'refund', 'completed', $2, 'USD', $2, 'USD', $3, $4, NOW(), NOW())
	`, buyerID, amount, fmt.Sprintf("Auto-refund for property escrow plan %s (dispute %s) — %d-day grace period elapsed", planID, disputeID, gracePeriodDays), refRef)
	if err != nil {
		return fmt.Errorf("insert refund tx: %w", err)
	}

	// Update dispute status
	_, err = tx.ExecContext(ctx, `
		UPDATE property_escrow_disputes
		SET status = 'refund_completed', refund_amount_usd = $1, refund_completed_at = NOW(), updated_at = NOW()
		WHERE dispute_id = $2
	`, amount, disputeID)
	if err != nil {
		return fmt.Errorf("update dispute: %w", err)
	}

	// Update escrow plan status
	_, err = tx.ExecContext(ctx, `
		UPDATE property_escrow_plans
		SET status = 'refunded', cancelled_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, planDBID)
	if err != nil {
		return fmt.Errorf("update plan: %w", err)
	}

	// Audit log
	_, _ = tx.ExecContext(ctx, `
		INSERT INTO audit_logs ("userId", action, metadata, "createdAt")
		VALUES ($1, 'AUTO_REFUND_EXECUTED', $2::jsonb, NOW())
	`, buyerID, fmt.Sprintf(`{"disputeId":"%s","planId":"%s","refundAmount":%.2f,"reason":"grace_period_elapsed"}`, disputeID, planID, amount))

	// Notify buyer
	_, _ = tx.ExecContext(ctx, `
		INSERT INTO notifications ("userId", type, message, "createdAt")
		VALUES ($1, 'auto_refund', $2, NOW())
	`, buyerID, fmt.Sprintf("Your property escrow plan %s has been automatically refunded. $%.2f has been credited to your USD wallet. Dispute: %s", planID, amount, disputeID))

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	m.metrics.mu.Lock()
	m.metrics.AutoRefundsTriggered++
	m.metrics.mu.Unlock()

	log.Printf("[AUTO_REFUND] Executed for dispute %s (plan %s, buyer %d, amount $%.2f)", disputeID, planID, buyerID, amount)
	return nil
}

// ─── Stale Plan Detection ────────────────────────────────────────────────────

func (m *EscrowMonitor) scanStalePlans(ctx context.Context) (int, error) {
	query := `
		SELECT pep.plan_id, pep.buyer_id, pep.status, pep.updated_at
		FROM property_escrow_plans pep
		WHERE pep.status = 'active'
		  AND pep.updated_at < NOW() - INTERVAL '%d days'
		LIMIT 100
	`
	rows, err := m.db.QueryContext(ctx, fmt.Sprintf(query, stalePlanDays))
	if err != nil {
		return 0, fmt.Errorf("query stale plans: %w", err)
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var planID string
		var buyerID int
		var status string
		var updatedAt time.Time
		if err := rows.Scan(&planID, &buyerID, &status, &updatedAt); err != nil {
			continue
		}

		daysSinceUpdate := int(time.Since(updatedAt).Hours() / 24)
		_, _ = m.db.ExecContext(ctx, `
			INSERT INTO notifications ("userId", type, message, "createdAt")
			VALUES ($1, 'stale_plan_warning', $2, NOW())
		`, buyerID, fmt.Sprintf("Your property escrow plan %s has had no activity for %d days. Please check your milestone progress or contact support.", planID, daysSinceUpdate))

		log.Printf("[STALE_PLAN] Plan %s (buyer %d) — no activity for %d days", planID, buyerID, daysSinceUpdate)
		count++
	}

	m.metrics.mu.Lock()
	m.metrics.StalePlansDetected += int64(count)
	m.metrics.mu.Unlock()

	return count, rows.Err()
}

// ─── Main Scan Loop ──────────────────────────────────────────────────────────

func (m *EscrowMonitor) runScan(ctx context.Context) {
	start := time.Now()
	log.Println("[SCAN] Starting escrow deadline scan...")

	overdue, err1 := m.scanOverdueMilestones(ctx)
	expired, err2 := m.scanExpiredCureNotices(ctx)
	refunds, err3 := m.processAutoRefunds(ctx)
	stale, err4 := m.scanStalePlans(ctx)

	duration := time.Since(start)

	m.metrics.mu.Lock()
	m.metrics.TotalScans++
	m.metrics.OverdueMilestones += int64(overdue)
	m.metrics.LastScanAt = time.Now()
	m.metrics.LastScanDurationMs = duration.Milliseconds()
	m.metrics.mu.Unlock()

	log.Printf("[SCAN] Complete in %dms — overdue: %d, cure_expired: %d, auto_refunds: %d, stale: %d",
		duration.Milliseconds(), overdue, expired, refunds, stale)

	for _, err := range []error{err1, err2, err3, err4} {
		if err != nil {
			log.Printf("[SCAN_ERROR] %v", err)
		}
	}
}

// ─── HTTP Server ─────────────────────────────────────────────────────────────

func (m *EscrowMonitor) healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "ok",
		"service": "go-escrow-monitor",
		"uptime":  time.Since(time.Now()).String(),
	})
}

func (m *EscrowMonitor) metricsHandler(w http.ResponseWriter, r *http.Request) {
	m.metrics.mu.Lock()
	defer m.metrics.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m.metrics)
}

func (m *EscrowMonitor) triggerScanHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	go m.runScan(context.Background())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "scan_triggered"})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = defaultPort
	}
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

	monitor := &EscrowMonitor{
		db:      db,
		metrics: &Metrics{},
	}

	// Start periodic scanner
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go func() {
		// Run immediately on startup
		monitor.runScan(ctx)
		ticker := time.NewTicker(time.Duration(scanIntervalMinutes) * time.Minute)
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

	// HTTP endpoints
	mux := http.NewServeMux()
	mux.HandleFunc("/health", monitor.healthHandler)
	mux.HandleFunc("/metrics", monitor.metricsHandler)
	mux.HandleFunc("/scan", monitor.triggerScanHandler)

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("[SHUTDOWN] Shutting down escrow monitor...")
		cancel()
		srv.Shutdown(context.Background())
	}()

	log.Printf("[START] Property Escrow Deadline Monitor listening on :%s (scan every %d min)", port, scanIntervalMinutes)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
