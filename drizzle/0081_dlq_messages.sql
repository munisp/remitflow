-- Kafka DLQ Persistence — dlq_messages
-- Backs server/middleware/kafkaConsumer.ts: messages whose handlers exhaust
-- in-process retries are routed to the remitflow.dlq topic, then drained into
-- this table by the remitflow-dlq-persistence consumer group. Rows are
-- reprocessed via reprocessDlqMessages(). Idempotent so it is safe to
-- (re)apply on any environment.

CREATE TABLE IF NOT EXISTS "dlq_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  -- Coordinates of the message inside the DLQ topic itself (dedupe key)
  "topic" varchar(200) NOT NULL,
  "partition" integer NOT NULL,
  "offset" bigint NOT NULL,
  "key" varchar(500),
  -- Envelope fields produced by sendToDLQ() in server/middleware/kafka.ts
  "original_topic" varchar(200),
  "payload" text NOT NULL,
  "error" text,
  -- 'pending' | 'reprocessed' | 'failed'
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "failed_at" timestamp DEFAULT now(),
  "reprocess_count" integer DEFAULT 0 NOT NULL,
  "next_retry_at" timestamp,
  "reprocessed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

-- One row per DLQ-topic message (prevents duplicate persistence on redelivery)
CREATE UNIQUE INDEX IF NOT EXISTS "dlq_messages_topic_partition_offset_idx"
  ON "dlq_messages" ("topic", "partition", "offset");

CREATE INDEX IF NOT EXISTS "dlq_messages_status_idx"
  ON "dlq_messages" ("status");

CREATE INDEX IF NOT EXISTS "dlq_messages_original_topic_idx"
  ON "dlq_messages" ("original_topic");

CREATE INDEX IF NOT EXISTS "dlq_messages_next_retry_idx"
  ON "dlq_messages" ("next_retry_at")
  WHERE "status" = 'pending';
