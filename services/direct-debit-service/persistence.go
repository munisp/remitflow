// persistence.go — Postgres write-through persistence for direct-debit-service (W19).
//
// Mandates and collections were previously volatile in-memory maps. PG is now
// the durable store: request-path creations write through synchronously
// (fail closed), async status transitions write through with loud error
// logging, and maps are warmed from PG at boot.
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

func initDB() {
	dsn := getEnv("DATABASE_URL", "")
	if dsn == "" {
		if !devEnv() {
			log.Fatalf("DATABASE_URL is required outside dev/test — refusing to boot in volatile in-memory mode (fail closed)")
		}
		log.Printf("[direct-debit] WARN: DATABASE_URL not set — mandates/collections are VOLATILE in-memory (dev mode only)")
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
			log.Fatalf("[direct-debit] FATAL: migration failed (fail closed): %v", err)
		}
		log.Printf("[direct-debit] migrations applied (AUTO_MIGRATE=1)")
	}
	loadFromDB()
}

// dbUpsert synchronously upserts a JSONB row; nil db = volatile dev mode.
func dbUpsert(table, id string, v interface{}) error {
	if db == nil {
		return nil
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

func loadFromDB() {
	if db == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	mrows, err := db.QueryContext(ctx, `SELECT id, data FROM dd_mandates`)
	if err != nil {
		log.Printf("[direct-debit] WARN: mandate boot-load failed: %v", err)
	} else {
		defer mrows.Close()
		n := 0
		for mrows.Next() {
			var id, data string
			if mrows.Scan(&id, &data) != nil {
				continue
			}
			var m DirectDebitMandate
			if json.Unmarshal([]byte(data), &m) != nil {
				continue
			}
			mandates[id] = &m
			n++
		}
		log.Printf("[direct-debit] loaded %d mandates from Postgres", n)
	}

	crows, err := db.QueryContext(ctx, `SELECT id, data FROM dd_collections`)
	if err != nil {
		log.Printf("[direct-debit] WARN: collection boot-load failed: %v", err)
	} else {
		defer crows.Close()
		n := 0
		for crows.Next() {
			var id, data string
			if crows.Scan(&id, &data) != nil {
				continue
			}
			var col DDCollection
			if json.Unmarshal([]byte(data), &col) != nil {
				continue
			}
			collections[id] = &col
			n++
		}
		log.Printf("[direct-debit] loaded %d collections from Postgres", n)
	}
}
