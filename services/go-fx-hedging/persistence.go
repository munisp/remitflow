// persistence.go — Postgres write-through persistence for go-fx-hedging (W19).
//
// Forward contracts and FX options (derivative contracts — money) were
// volatile in-memory maps. PG is now the durable store: creations write
// through synchronously (fail closed) and the maps are warmed at boot.
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
		slog.Warn("[FXHedging] DATABASE_URL not set — forwards/options are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		slog.Warn("[FXHedging] db open failed — volatile in-memory mode", "err", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		slog.Warn("[FXHedging] db ping failed — volatile in-memory mode", "err", err)
		db.Close()
		db = nil
		return
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			slog.Error("[FXHedging] FATAL: migration failed (fail closed)", "err", err)
			panic(err)
		}
		slog.Info("[FXHedging] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

func dbUpsert(table, id string, userID int64, status string, v interface{}) error {
	if db == nil {
		return nil // volatile dev mode
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO `+table+` (id, user_id, status, data, updated_at)
		 VALUES ($1, $2, $3, $4::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, status = EXCLUDED.status,
		 data = EXCLUDED.data, updated_at = NOW()`,
		id, userID, status, string(data))
	return err
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	frows, err := db.QueryContext(ctx, `SELECT id, data FROM fx_forward_contracts`)
	if err != nil {
		slog.Warn("[FXHedging] forwards boot-load failed", "err", err)
	} else {
		defer frows.Close()
		n := 0
		for frows.Next() {
			var id, data string
			if frows.Scan(&id, &data) != nil {
				continue
			}
			var f ForwardContract
			if json.Unmarshal([]byte(data), &f) != nil {
				continue
			}
			forwards[id] = &f
			n++
		}
		slog.Info("[FXHedging] loaded forwards from Postgres", "count", n)
	}

	orows, err := db.QueryContext(ctx, `SELECT id, data FROM fx_options`)
	if err != nil {
		slog.Warn("[FXHedging] options boot-load failed", "err", err)
	} else {
		defer orows.Close()
		n := 0
		for orows.Next() {
			var id, data string
			if orows.Scan(&id, &data) != nil {
				continue
			}
			var o FxOption
			if json.Unmarshal([]byte(data), &o) != nil {
				continue
			}
			options[id] = &o
			n++
		}
		slog.Info("[FXHedging] loaded options from Postgres", "count", n)
	}
}
