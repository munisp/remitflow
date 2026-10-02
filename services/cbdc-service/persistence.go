// persistence.go — Postgres write-through persistence for cbdc-service (W19).
//
// The package-level wallets/transfers maps were previously volatile: a restart
// lost CBDC balances and transfer history. PostgreSQL is now the durable
// store: mutations write through synchronously (fail-closed on money paths)
// and the in-memory maps are warmed from PG at boot.
//
// If DATABASE_URL is unset the service runs in volatile in-memory mode
// (dev/test only) with a loud boot warning — no silent data loss.
package main

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"
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

// initDB connects to Postgres, applies migrations when AUTO_MIGRATE=1, and
// warms the in-memory stores. On any connection failure the service degrades
// to in-memory mode with a WARN (dev parity with existing Go services).
func initDB() {
	dsn := getEnv("DATABASE_URL", "")
	if dsn == "" {
		if !devEnv() {
			log.Fatalf("DATABASE_URL is required outside dev/test — refusing to boot in volatile in-memory mode (fail closed)")
		}
		log.Printf("[cbdc-service] WARN: DATABASE_URL not set — wallets/transfers are VOLATILE in-memory (dev mode only)")
		return
	}
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("DATABASE_URL is set but the database is unreachable (open failed: %v) — failing closed", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		log.Fatalf("DATABASE_URL is set but the database is unreachable (ping failed: %v) — failing closed", err)
	}
	if getEnv("AUTO_MIGRATE", "") == "1" {
		if _, err := db.ExecContext(ctx, migrationSQL); err != nil {
			log.Fatalf("[cbdc-service] FATAL: migration failed (fail closed): %v", err)
		}
		log.Printf("[cbdc-service] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

// dbUpsert synchronously upserts a JSONB row. Returns error when the write
// fails; callers on money paths must treat an error as fatal to the operation
// (fail closed — PG is the source of truth).
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

// dbUpsertTx is dbUpsert inside a caller-managed transaction.
func dbUpsertTx(tx *sql.Tx, table, id string, v interface{}) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = tx.Exec(fmt.Sprintf(
		`INSERT INTO %s (id, data, updated_at) VALUES ($1, $2::jsonb, NOW())
		 ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, table),
		id, string(data))
	return err
}

// persistTransferTx atomically persists a settled transfer + both wallet
// balance updates (spec: db.transaction wraps multi-writes).
func persistTransferTx(t *CBDCTransfer, from, to *CBDCWallet) error {
	if db == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := dbUpsertTx(tx, "cbdc_wallets", from.ID, from); err != nil {
		return err
	}
	if err := dbUpsertTx(tx, "cbdc_wallets", to.ID, to); err != nil {
		return err
	}
	if err := dbUpsertTx(tx, "cbdc_transfers", t.ID, t); err != nil {
		return err
	}
	return tx.Commit()
}

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	wrows, err := db.QueryContext(ctx, `SELECT id, data FROM cbdc_wallets`)
	if err != nil {
		log.Printf("[cbdc-service] WARN: wallet boot-load failed: %v", err)
	} else {
		defer wrows.Close()
		n := 0
		for wrows.Next() {
			var id, data string
			if wrows.Scan(&id, &data) != nil {
				continue
			}
			var w CBDCWallet
			if json.Unmarshal([]byte(data), &w) != nil {
				continue
			}
			wallets[id] = &w
			n++
		}
		log.Printf("[cbdc-service] loaded %d wallets from Postgres", n)
	}

	trows, err := db.QueryContext(ctx, `SELECT id, data FROM cbdc_transfers`)
	if err != nil {
		log.Printf("[cbdc-service] WARN: transfer boot-load failed: %v", err)
	} else {
		defer trows.Close()
		n := 0
		for trows.Next() {
			var id, data string
			if trows.Scan(&id, &data) != nil {
				continue
			}
			var t CBDCTransfer
			if json.Unmarshal([]byte(data), &t) != nil {
				continue
			}
			transfers[id] = &t
			n++
		}
		log.Printf("[cbdc-service] loaded %d transfers from Postgres", n)
	}
}
