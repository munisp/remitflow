// persistence.go — Postgres write-through persistence for go-defi-yield (W19).
//
// The positions map (user DeFi deposits/withdrawals — money) was volatile.
// PG is now the durable store: deposit/withdraw write through synchronously
// (fail closed), auto-compound updates write through with loud error logging,
// and the map is warmed from PG at boot.
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/0001_init.sql
var migrationSQL string

var db *sql.DB

// devEnv reports whether the process runs in a dev/test environment where
// volatile in-memory mode is tolerated. Outside dev/test the service fails
// closed (W20 DL-12/13/14) rather than silently losing durable state.
func devEnv() bool {
	for _, k := range []string{"APP_ENV", "ENV", "GO_ENV"} {
		switch strings.ToLower(strings.TrimSpace(os.Getenv(k))) {
		case "dev", "development", "test":
			return true
		}
	}
	return false
}

// failClosed logs a FATAL boot error and exits when durable storage is
// unavailable outside dev/test.
func failClosed(format string, args ...interface{}) {
	slog.Error("FATAL: " + fmt.Sprintf(format, args...))
	os.Exit(1)
}

func initDB() {
	dsn := getEnv("DATABASE_URL", "")
	if dsn == "" {
		if !devEnv() {
			failClosed("DATABASE_URL is required outside dev/test — refusing to boot in volatile in-memory mode (fail closed)")
		}
		slog.Warn("[DeFiYield] DATABASE_URL not set — positions are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		failClosed("DATABASE_URL is set but the database is unreachable (open failed: %v) — failing closed", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		failClosed("DATABASE_URL is set but the database is unreachable (ping failed: %v) — failing closed", err)
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			slog.Error("[DeFiYield] FATAL: migration failed (fail closed)", "err", err)
			panic(err)
		}
		slog.Info("[DeFiYield] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

// persistPosition synchronously upserts a position row; nil db = volatile dev
// mode. Money-path callers must treat an error as fatal to the operation.
func persistPosition(pos *Position) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(pos)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO defi_yield_positions (id, user_id, status, data, updated_at)
		 VALUES ($1, $2, $3, $4::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, status = EXCLUDED.status,
		 data = EXCLUDED.data, updated_at = NOW()`,
		pos.ID, pos.UserID, pos.Status, string(data))
	return err
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `SELECT id, data FROM defi_yield_positions`)
	if err != nil {
		slog.Warn("[DeFiYield] position boot-load failed", "err", err)
		return
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, data string
		if rows.Scan(&id, &data) != nil {
			continue
		}
		var p Position
		if json.Unmarshal([]byte(data), &p) != nil {
			continue
		}
		positions[id] = &p
		n++
	}
	slog.Info("[DeFiYield] loaded positions from Postgres", "count", n)
}
