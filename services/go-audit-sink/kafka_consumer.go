// kafka_consumer.go — Kafka consumer group for go-audit-sink (W20 DL-25).
//
// The sink previously only accepted HTTP ingest; audit events published to
// Kafka had no Go-side durable consumer. This consumer joins group
// "go-audit-sink" and appends every message on the audit topics to the
// hash-chained immutable log (PG-backed when DATABASE_URL is set).
//
// Fail closed: a message is NOT offset-committed until it is durably
// appended; on append failure the consumer logs loudly and retries, so an
// audit event is never silently dropped.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/segmentio/kafka-go"
)

// defaultAuditTopics are the registry audit topics this sink was built for
// (see server/middleware/kafka.ts KAFKA_TOPICS). Overridable via
// AUDIT_KAFKA_TOPICS (comma-separated).
const defaultAuditTopics = "remitflow.audit.stream"
const defaultAuditGroup = "go-audit-sink"

// startKafkaConsumer launches the audit-topic consumer group. It blocks until
// ctx is cancelled. KAFKA_BROKERS unset → consumer disabled with a WARN (HTTP
// ingest still works); the fail-closed DB guard in persistence.go still
// applies independently.
func startKafkaConsumer(ctx context.Context) {
	brokersRaw := getEnvOrDefault("KAFKA_BROKERS", "")
	if brokersRaw == "" {
		log.Printf("[go-audit-sink] WARN: KAFKA_BROKERS not set — audit Kafka consumer DISABLED (HTTP ingest still active)")
		return
	}
	brokers := strings.Split(brokersRaw, ",")
	for i := range brokers {
		brokers[i] = strings.TrimSpace(brokers[i])
	}
	topics := strings.Split(getEnvOrDefault("AUDIT_KAFKA_TOPICS", defaultAuditTopics), ",")
	for i := range topics {
		topics[i] = strings.TrimSpace(topics[i])
	}
	group := getEnvOrDefault("AUDIT_KAFKA_GROUP", defaultAuditGroup)

	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        brokers,
		GroupID:        group,
		GroupTopics:    topics,
		MinBytes:       1,
		MaxBytes:       10 << 20,
		CommitInterval: 0, // explicit commits only — never auto-commit unprocessed offsets
		StartOffset:    kafka.FirstOffset,
	})
	defer reader.Close()
	log.Printf("[go-audit-sink] Kafka consumer group %q consuming audit topics %v from %v", group, topics, brokers)

	for {
		msg, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			log.Printf("[go-audit-sink] ERROR: kafka fetch failed: %v — retrying in 2s", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
			continue
		}
		if err := appendKafkaAuditMessage(msg); err != nil {
			// Fail closed: do NOT commit; the message will be redelivered.
			log.Printf("[go-audit-sink] ERROR: audit append failed for %s@%d (topic %s): %v — offset NOT committed, will retry",
				string(msg.Key), msg.Offset, msg.Topic, err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
			continue
		}
		if err := reader.CommitMessages(ctx, msg); err != nil {
			// Entry is durable; a duplicate on redelivery is acceptable and
			// detectable via the hash chain. Never silent.
			log.Printf("[go-audit-sink] WARN: offset commit failed after durable append (topic %s offset %d): %v",
				msg.Topic, msg.Offset, err)
		}
	}
}

// appendKafkaAuditMessage maps a Kafka audit event (heterogeneous JSON
// payloads from server middleware / fund-flow hardening) onto an AuditEntry
// and appends it to the immutable hash-chained log.
func appendKafkaAuditMessage(msg kafka.Message) error {
	var payload map[string]interface{}
	if err := json.Unmarshal(msg.Value, &payload); err != nil {
		return fmt.Errorf("audit message is not valid JSON: %w", err)
	}

	entry := AuditEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		EventType: "kafka_audit_event",
		Outcome:   "success",
		Metadata: map[string]interface{}{
			"kafka_topic":     msg.Topic,
			"kafka_partition": msg.Partition,
			"kafka_offset":    msg.Offset,
			"payload":         payload,
		},
	}
	if ts, ok := payload["timestamp"].(string); ok && ts != "" {
		entry.Timestamp = ts
	}
	if t, ok := payload["type"].(string); ok && t != "" {
		entry.EventType = t
	} else if a, ok := payload["action"].(string); ok && a != "" {
		entry.EventType = a
		entry.Action = a
	}
	if uid, ok := payload["userId"].(float64); ok {
		entry.ActorID = int(uid)
	}
	if res, ok := payload["resource"].(string); ok {
		entry.Resource = res
	}
	if ip, ok := payload["ip"].(string); ok {
		entry.IPAddress = ip
	} else if ip, ok := payload["ipAddress"].(string); ok {
		entry.IPAddress = ip
	}
	if success, ok := payload["success"].(bool); ok && !success {
		entry.Outcome = "failure"
	}

	stored, err := store.Append(entry)
	if err != nil {
		return err
	}
	log.Printf("[go-audit-sink] audit event appended from kafka topic %s (pos %d, hash %s)",
		msg.Topic, stored.ChainPosition, stored.EntryHash[:16])
	return nil
}
