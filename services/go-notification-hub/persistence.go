// persistence.go — Postgres write-through persistence for go-notification-hub (W19).
//
// Delivery records (notification audit trail) were a volatile in-memory ring
// buffer. Every record now inserts into notification_deliveries; the ring
// buffer remains as a hot read cache and is warmed from PG at boot. Insert
// failures are logged loudly (fail-open: a notification must not be dropped
// because the audit insert failed).
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"log/slog"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/0001_init.sql
var migrationSQL string

var db *sql.DB

func initDB() {
	dsn := getEnv("DATABASE_URL", "")
	if dsn == "" {
		slog.Warn("[NotifHub] DATABASE_URL not set — delivery records are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		slog.Warn("[NotifHub] db open failed — volatile in-memory mode", "err", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		slog.Warn("[NotifHub] db ping failed — volatile in-memory mode", "err", err)
		db.Close()
		db = nil
		return
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			slog.Error("[NotifHub] FATAL: migration failed (fail closed)", "err", err)
			panic(err)
		}
		slog.Info("[NotifHub] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

// persistDeliveryRecord inserts the delivery audit row. Fail-open for the
// notification itself, but NEVER silent on failure.
func persistDeliveryRecord(rec *DeliveryRecord) {
	if db == nil {
		return // volatile dev mode
	}
	data, err := json.Marshal(rec)
	if err != nil {
		slog.Error("[NotifHub] delivery record marshal failed", "id", rec.ID, "err", err)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx,
		`INSERT INTO notification_deliveries (id, user_id, channel, status, data, created_at)
		 VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data`,
		rec.ID, rec.UserID, string(rec.Channel), rec.Status, string(data)); err != nil {
		slog.Error("[NotifHub] delivery record persist failed", "id", rec.ID, "err", err)
	}
}

// loadFromDB warms the ring buffer with the most recent records.
func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx,
		`SELECT data FROM notification_deliveries ORDER BY created_at DESC LIMIT 1000`)
	if err != nil {
		slog.Warn("[NotifHub] delivery boot-load failed", "err", err)
		return
	}
	defer rows.Close()
	var loaded []DeliveryRecord
	for rows.Next() {
		var data string
		if rows.Scan(&data) != nil {
			continue
		}
		var rec DeliveryRecord
		if json.Unmarshal([]byte(data), &rec) != nil {
			continue
		}
		loaded = append(loaded, rec)
	}
	// Restore chronological order (query was DESC).
	for i, j := 0, len(loaded)-1; i < j; i, j = i+1, j-1 {
		loaded[i], loaded[j] = loaded[j], loaded[i]
	}
	hub.mu.Lock()
	hub.records = append(hub.records, loaded...)
	hub.mu.Unlock()
	slog.Info("[NotifHub] loaded delivery records from Postgres", "count", len(loaded))
}
