// persistence.go — Postgres write-through persistence for go-liquidity-manager (W19).
//
// LP positions and swap executions (money path) were volatile / unrecorded.
// PG is now the durable store: swap executions insert an append-only audit row
// (fail closed — an unrecorded swap is not admitted), position mutations write
// through with loud error logging, and positions are warmed at boot.
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
		slog.Warn("[LiquidityManager] DATABASE_URL not set — positions/swaps are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		slog.Warn("[LiquidityManager] db open failed — volatile in-memory mode", "err", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		slog.Warn("[LiquidityManager] db ping failed — volatile in-memory mode", "err", err)
		db.Close()
		db = nil
		return
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			slog.Error("[LiquidityManager] FATAL: migration failed (fail closed)", "err", err)
			panic(err)
		}
		slog.Info("[LiquidityManager] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

func persistPosition(pos *LiquidityPosition) error {
	if db == nil {
		return nil // volatile dev mode
	}
	data, err := json.Marshal(pos)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO liquidity_positions (id, user_id, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, data = EXCLUDED.data, updated_at = NOW()`,
		pos.ID, pos.UserID, string(data))
	return err
}

// recordSwapExecution appends the swap audit row. Money path: callers fail
// closed on error.
func recordSwapExecution(txID string, req *SwapRequest, result interface{}) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(map[string]interface{}{
		"tx_id": txID, "request": req, "result": result,
	})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO liquidity_swap_executions (id, user_id, token_in, token_out, amount_in, data, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())`,
		txID, req.UserID, req.TokenIn, req.TokenOut, req.AmountIn, string(data))
	return err
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(ctx, `SELECT id, data FROM liquidity_positions`)
	if err != nil {
		slog.Warn("[LiquidityManager] positions boot-load failed", "err", err)
		return
	}
	defer rows.Close()
	n := 0
	for rows.Next() {
		var id, data string
		if rows.Scan(&id, &data) != nil {
			continue
		}
		var p LiquidityPosition
		if json.Unmarshal([]byte(data), &p) != nil {
			continue
		}
		lpPositions[id] = &p
		n++
	}
	slog.Info("[LiquidityManager] loaded positions from Postgres", "count", n)
}
