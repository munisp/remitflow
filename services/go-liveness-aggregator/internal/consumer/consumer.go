// Package consumer implements a Kafka consumer that reads from the
// "kyc.liveness.result" topic and dispatches events to the DB aggregator.
package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/remitflow/liveness-aggregator/internal/db"
	"github.com/remitflow/liveness-aggregator/internal/metrics"
	"github.com/remitflow/liveness-aggregator/internal/model"
	"github.com/rs/zerolog/log"
	"github.com/segmentio/kafka-go"
)

const (
	topic         = "kyc.liveness.result"
	consumerGroup = "liveness-aggregator-v1"
	maxRetries    = 3
	retryBackoff  = 500 * time.Millisecond
)

// Config holds Kafka broker addresses and optional TLS settings.
type Config struct {
	Brokers  []string
	StartLag time.Duration // how far back to start on first run (default: 24h)
}

// Consumer reads liveness result events from Kafka and writes aggregated
// stats to PostgreSQL.
type Consumer struct {
	cfg    Config
	db     *db.Client
	reader *kafka.Reader
}

// New creates a new Consumer. Call Run() to start processing.
func New(cfg Config, dbClient *db.Client) *Consumer {
	startOffset := kafka.LastOffset
	if cfg.StartLag > 0 {
		// kafka-go does not support time-based offset directly; use FirstOffset
		// for backfill scenarios and rely on consumer group commit for resume.
		startOffset = kafka.FirstOffset
	}

	r := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        cfg.Brokers,
		Topic:          topic,
		GroupID:        consumerGroup,
		MinBytes:       1,
		MaxBytes:       10 << 20, // 10 MiB
		MaxWait:        500 * time.Millisecond,
		StartOffset:    startOffset,
		CommitInterval: time.Second,
		Logger:         kafka.LoggerFunc(func(msg string, args ...interface{}) {
			log.Debug().Msgf("[kafka] "+msg, args...)
		}),
		ErrorLogger: kafka.LoggerFunc(func(msg string, args ...interface{}) {
			log.Error().Msgf("[kafka] "+msg, args...)
		}),
	})

	return &Consumer{cfg: cfg, db: dbClient, reader: r}
}

// Run blocks and processes messages until ctx is cancelled.
func (c *Consumer) Run(ctx context.Context) error {
	log.Info().
		Strs("brokers", c.cfg.Brokers).
		Str("topic", topic).
		Str("group", consumerGroup).
		Msg("[aggregator] Kafka consumer started")

	for {
		msg, err := c.reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				log.Info().Msg("[aggregator] context cancelled, stopping consumer")
				return nil
			}
			log.Error().Err(err).Msg("[aggregator] fetch message error")
			time.Sleep(retryBackoff)
			continue
		}

		metrics.EventsReceived.Inc()

		if err := c.processWithRetry(ctx, msg); err != nil {
			log.Error().
				Err(err).
				Int64("offset", msg.Offset).
				Str("key", string(msg.Key)).
				Msg("[aggregator] failed to process message after retries — skipping")
			metrics.EventsFailed.Inc()
		} else {
			metrics.EventsProcessed.Inc()
		}

		// Commit regardless of processing outcome to avoid infinite loops on
		// poison-pill messages. Failed events are logged and counted in metrics.
		if err := c.reader.CommitMessages(ctx, msg); err != nil {
			log.Warn().Err(err).Msg("[aggregator] commit failed")
		}
	}
}

// Close shuts down the Kafka reader.
func (c *Consumer) Close() error {
	return c.reader.Close()
}

func (c *Consumer) processWithRetry(ctx context.Context, msg kafka.Message) error {
	var ev model.LivenessResultEvent
	if err := json.Unmarshal(msg.Value, &ev); err != nil {
		return fmt.Errorf("unmarshal event: %w", err)
	}

	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		if err := c.process(ctx, &ev); err != nil {
			lastErr = err
			log.Warn().
				Err(err).
				Int("attempt", attempt).
				Str("event_id", ev.EventID).
				Msg("[aggregator] process attempt failed")
			time.Sleep(retryBackoff * time.Duration(attempt))
			continue
		}
		return nil
	}
	return lastErr
}

func (c *Consumer) process(ctx context.Context, ev *model.LivenessResultEvent) error {
	// 1. Persist the raw audit row (idempotent via ON CONFLICT DO NOTHING)
	if err := c.db.UpsertAuditRow(ctx, ev); err != nil {
		return fmt.Errorf("upsert audit row: %w", err)
	}

	// 2. Increment the hourly time-series bucket
	if err := c.db.IncrementHourlyStats(ctx, ev); err != nil {
		return fmt.Errorf("increment hourly stats: %w", err)
	}

	log.Info().
		Str("event_id", ev.EventID).
		Int64("user_id", ev.UserID).
		Bool("overall_live", ev.OverallLive).
		Str("corridor", ev.CorridorCode).
		Msg("[aggregator] event processed")
	return nil
}
