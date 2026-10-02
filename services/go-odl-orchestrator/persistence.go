// persistence.go — Postgres write-through persistence for go-odl-orchestrator (W19).
//
// Settlements, quotes, and corridor routes were volatile in-memory maps. PG is
// now the durable store: settlement creation/status transitions and quote
// issuance write through synchronously (fail closed on settlements), and all
// three maps are warmed from PG at boot (routes are seeded only when the DB
// has none).
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
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
		slog.Warn("[ODL] DATABASE_URL not set — settlements/quotes/routes are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		slog.Warn("[ODL] db open failed — volatile in-memory mode", "err", err)
		db = nil
		return
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		slog.Warn("[ODL] db ping failed — volatile in-memory mode", "err", err)
		db.Close()
		db = nil
		return
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			slog.Error("[ODL] FATAL: migration failed (fail closed)", "err", err)
			panic(err)
		}
		slog.Info("[ODL] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

func dbUpsert(table, id string, v interface{}) error {
	if db == nil {
		return nil // volatile dev mode
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx, fmt.Sprintf(
		`INSERT INTO %s (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, table),
		id, string(data))
	return err
}

func persistSettlement(s *ODLSettlement) error {
	if db == nil {
		return nil
	}
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err = db.ExecContext(ctx,
		`INSERT INTO odl_settlements (id, status, data, updated_at) VALUES ($1, $2, $3::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, data = EXCLUDED.data, updated_at = NOW()`,
		s.SettlementID, string(s.Status), string(data))
	return err
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	srows, err := db.QueryContext(ctx, `SELECT id, data FROM odl_settlements`)
	if err != nil {
		slog.Warn("[ODL] settlements boot-load failed", "err", err)
	} else {
		defer srows.Close()
		n := 0
		for srows.Next() {
			var id, data string
			if srows.Scan(&id, &data) != nil {
				continue
			}
			var s ODLSettlement
			if json.Unmarshal([]byte(data), &s) != nil {
				continue
			}
			store.settlements[id] = &s
			n++
		}
		slog.Info("[ODL] loaded settlements from Postgres", "count", n)
	}

	qrows, err := db.QueryContext(ctx, `SELECT id, data FROM odl_quotes WHERE updated_at > NOW() - INTERVAL '1 hour'`)
	if err != nil {
		slog.Warn("[ODL] quotes boot-load failed", "err", err)
	} else {
		defer qrows.Close()
		n := 0
		for qrows.Next() {
			var id, data string
			if qrows.Scan(&id, &data) != nil {
				continue
			}
			var q ODLQuote
			if json.Unmarshal([]byte(data), &q) != nil {
				continue
			}
			store.quotes[id] = &q
			n++
		}
		slog.Info("[ODL] loaded recent quotes from Postgres", "count", n)
	}

	rrows, err := db.QueryContext(ctx, `SELECT id, data FROM odl_routes`)
	if err != nil {
		slog.Warn("[ODL] routes boot-load failed", "err", err)
	} else {
		defer rrows.Close()
		n := 0
		for rrows.Next() {
			var id, data string
			if rrows.Scan(&id, &data) != nil {
				continue
			}
			var r CorridorRoute
			if json.Unmarshal([]byte(data), &r) != nil {
				continue
			}
			store.routes[id] = &r
			n++
		}
		slog.Info("[ODL] loaded routes from Postgres", "count", n)
	}
}
