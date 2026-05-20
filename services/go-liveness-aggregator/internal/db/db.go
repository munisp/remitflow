// Package db provides PostgreSQL helpers for the liveness aggregator.
// It writes to two tables:
//   - kyc_liveness_audit     (per-event row, shared with Node.js)
//   - liveness_stats_hourly  (pre-aggregated time-series for dashboards)
package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
	_ "github.com/lib/pq"
	"github.com/remitflow/liveness-aggregator/internal/model"
	"github.com/rs/zerolog/log"
)

// Client wraps a sqlx.DB connection pool.
type Client struct {
	db *sqlx.DB
}

// New opens a PostgreSQL connection pool and verifies connectivity.
func New(dsn string) (*Client, error) {
	db, err := sqlx.Open("postgres", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return &Client{db: db}, nil
}

// Close releases the connection pool.
func (c *Client) Close() { _ = c.db.Close() }

// EnsureSchema creates the liveness_stats_hourly table if it does not exist.
// The kyc_liveness_audit table is managed by Drizzle migrations.
func (c *Client) EnsureSchema(ctx context.Context) error {
	_, err := c.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS liveness_stats_hourly (
			id              BIGSERIAL PRIMARY KEY,
			bucket          TIMESTAMPTZ NOT NULL,          -- truncated to the hour (UTC)
			corridor_code   VARCHAR(10)  NOT NULL DEFAULT '',
			total           INTEGER      NOT NULL DEFAULT 0,
			passed          INTEGER      NOT NULL DEFAULT 0,
			failed          INTEGER      NOT NULL DEFAULT 0,
			deepfake_count  INTEGER      NOT NULL DEFAULT 0,
			spoofing_count  INTEGER      NOT NULL DEFAULT 0,
			avg_passive_score NUMERIC(5,4),
			avg_deepfake_score NUMERIC(5,4),
			UNIQUE (bucket, corridor_code)
		);
		CREATE INDEX IF NOT EXISTS liveness_stats_hourly_bucket_idx
			ON liveness_stats_hourly (bucket DESC);
		CREATE INDEX IF NOT EXISTS liveness_stats_hourly_corridor_idx
			ON liveness_stats_hourly (corridor_code, bucket DESC);
	`)
	return err
}

// UpsertAuditRow inserts a new row into kyc_liveness_audit.
// If a row with the same event_id already exists (idempotency), it is skipped.
func (c *Client) UpsertAuditRow(ctx context.Context, ev *model.LivenessResultEvent) error {
	_, err := c.db.ExecContext(ctx, `
		INSERT INTO kyc_liveness_audit (
			user_id, kyc_doc_id,
			passive_score, passive_passed, passive_spoofing_type,
			deepfake_score, deepfake_method, deepfake_passed,
			overall_live, source, created_at
		) VALUES (
			$1, NULLIF($2, 0),
			$3, $4, NULLIF($5, ''),
			$6, NULLIF($7, ''), $8,
			$9, $10, to_timestamp($11::bigint / 1000.0)
		)
		ON CONFLICT DO NOTHING
	`,
		ev.UserID, ev.KycDocID,
		ev.PassiveScore, ev.PassivePassed, ev.SpoofingType,
		ev.DeepfakeScore, ev.DeepfakeMethod, ev.DeepfakePassed,
		ev.OverallLive, ev.Source, ev.OccurredAt,
	)
	if err != nil {
		return fmt.Errorf("upsert audit row: %w", err)
	}
	return nil
}

// IncrementHourlyStats upserts the liveness_stats_hourly bucket for the
// event's hour, atomically incrementing all counters.
func (c *Client) IncrementHourlyStats(ctx context.Context, ev *model.LivenessResultEvent) error {
	bucket := time.UnixMilli(ev.OccurredAt).UTC().Truncate(time.Hour)

	passed := 0
	failed := 0
	if ev.OverallLive {
		passed = 1
	} else {
		failed = 1
	}
	deepfakeCount := 0
	if ev.DeepfakePassed != nil && !*ev.DeepfakePassed {
		deepfakeCount = 1
	}
	spoofingCount := 0
	if ev.SpoofingType != "" {
		spoofingCount = 1
	}

	_, err := c.db.ExecContext(ctx, `
		INSERT INTO liveness_stats_hourly
			(bucket, corridor_code, total, passed, failed, deepfake_count, spoofing_count,
			 avg_passive_score, avg_deepfake_score)
		VALUES
			($1, $2, 1, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (bucket, corridor_code) DO UPDATE SET
			total          = liveness_stats_hourly.total + 1,
			passed         = liveness_stats_hourly.passed + EXCLUDED.passed,
			failed         = liveness_stats_hourly.failed + EXCLUDED.failed,
			deepfake_count = liveness_stats_hourly.deepfake_count + EXCLUDED.deepfake_count,
			spoofing_count = liveness_stats_hourly.spoofing_count + EXCLUDED.spoofing_count,
			avg_passive_score = CASE
				WHEN EXCLUDED.avg_passive_score IS NULL THEN liveness_stats_hourly.avg_passive_score
				ELSE (
					COALESCE(liveness_stats_hourly.avg_passive_score, 0) *
					(liveness_stats_hourly.total) +
					EXCLUDED.avg_passive_score
				) / (liveness_stats_hourly.total + 1)
			END,
			avg_deepfake_score = CASE
				WHEN EXCLUDED.avg_deepfake_score IS NULL THEN liveness_stats_hourly.avg_deepfake_score
				ELSE (
					COALESCE(liveness_stats_hourly.avg_deepfake_score, 0) *
					(liveness_stats_hourly.total) +
					EXCLUDED.avg_deepfake_score
				) / (liveness_stats_hourly.total + 1)
			END
	`,
		bucket, ev.CorridorCode,
		passed, failed, deepfakeCount, spoofingCount,
		passiveScoreOrNil(ev), deepfakeScoreOrNil(ev),
	)
	if err != nil {
		return fmt.Errorf("increment hourly stats: %w", err)
	}
	log.Debug().
		Time("bucket", bucket).
		Str("corridor", ev.CorridorCode).
		Bool("passed", ev.OverallLive).
		Msg("[aggregator] hourly stats updated")
	return nil
}

// GetHourlyStats returns the last N hours of aggregated stats, optionally
// filtered by corridor code.
func (c *Client) GetHourlyStats(ctx context.Context, hours int, corridor string) ([]HourlyStatRow, error) {
	query := `
		SELECT bucket, corridor_code, total, passed, failed,
		       deepfake_count, spoofing_count,
		       avg_passive_score, avg_deepfake_score
		FROM liveness_stats_hourly
		WHERE bucket >= NOW() - ($1 * INTERVAL '1 hour')
	`
	args := []any{hours}
	if corridor != "" {
		query += " AND corridor_code = $2"
		args = append(args, corridor)
	}
	query += " ORDER BY bucket DESC"

	rows, err := c.db.QueryxContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query hourly stats: %w", err)
	}
	defer rows.Close()

	var result []HourlyStatRow
	for rows.Next() {
		var r HourlyStatRow
		if err := rows.StructScan(&r); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// HourlyStatRow is a single row from liveness_stats_hourly.
type HourlyStatRow struct {
	Bucket            time.Time      `db:"bucket"`
	CorridorCode      string         `db:"corridor_code"`
	Total             int            `db:"total"`
	Passed            int            `db:"passed"`
	Failed            int            `db:"failed"`
	DeepfakeCount     int            `db:"deepfake_count"`
	SpoofingCount     int            `db:"spoofing_count"`
	AvgPassiveScore   sql.NullFloat64 `db:"avg_passive_score"`
	AvgDeepfakeScore  sql.NullFloat64 `db:"avg_deepfake_score"`
}

func passiveScoreOrNil(ev *model.LivenessResultEvent) any {
	if ev.PassiveScore == nil {
		return nil
	}
	return *ev.PassiveScore
}

func deepfakeScoreOrNil(ev *model.LivenessResultEvent) any {
	if ev.DeepfakeScore == nil {
		return nil
	}
	return *ev.DeepfakeScore
}
