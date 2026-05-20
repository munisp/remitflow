package fluvio

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fluvio "github.com/infinyon/fluvio-client-go/fluvio"
	"workflow-orchestrator/pkg/logger"
	"workflow-orchestrator/pkg/metrics"
)

// Client represents a Fluvio client for real-time event streaming
type Client struct {
	client   *fluvio.Fluvio
	producer *fluvio.TopicProducer
	config   *Config
}

// Config holds Fluvio configuration
type Config struct {
	SCAddr              string
	TopicWorkflowEvents string
}

// WorkflowEvent represents a workflow lifecycle event
type WorkflowEvent struct {
	EventID      string                 `json:"event_id"`
	EventType    string                 `json:"event_type"`
	Timestamp    time.Time              `json:"timestamp"`
	WorkflowID   string                 `json:"workflow_id"`
	WorkflowType string                 `json:"workflow_type"`
	Status       string                 `json:"status"`
	TenantID     string                 `json:"tenant_id"`
	UserID       string                 `json:"user_id"`
	Data         map[string]interface{} `json:"data"`
}

// NewClient creates a new Fluvio client
func NewClient(config *Config) (*Client, error) {
	// Create Fluvio client
	client, err := fluvio.Connect()
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Fluvio: %w", err)
	}

	// Create topic producer
	producer, err := fluvio.NewTopicProducer(client, config.TopicWorkflowEvents)
	if err != nil {
		client.Close()
		return nil, fmt.Errorf("failed to create Fluvio producer: %w", err)
	}

	return &Client{
		client:   client,
		producer: producer,
		config:   config,
	}, nil
}

// PublishWorkflowEvent publishes a workflow lifecycle event to Fluvio
func (c *Client) PublishWorkflowEvent(ctx context.Context, event *WorkflowEvent) error {
	start := time.Now()
	defer func() {
		metrics.EventsPublished.WithLabelValues(c.config.TopicWorkflowEvents, "success").Inc()
	}()

	// Marshal event to JSON
	data, err := json.Marshal(event)
	if err != nil {
		metrics.EventsPublished.WithLabelValues(c.config.TopicWorkflowEvents, "error").Inc()
		return fmt.Errorf("failed to marshal event: %w", err)
	}

	// Send record to Fluvio
	err = c.producer.SendRecord(string(data), event.WorkflowID)
	if err != nil {
		metrics.EventsPublished.WithLabelValues(c.config.TopicWorkflowEvents, "error").Inc()
		logger.Logger.Error("Failed to publish event to Fluvio", logger.Error(err))
		return fmt.Errorf("failed to publish event: %w", err)
	}

	logger.Logger.Info("Event published to Fluvio",
		logger.String("topic", c.config.TopicWorkflowEvents),
		logger.String("workflow_id", event.WorkflowID),
		logger.Duration("duration", time.Since(start)),
	)

	return nil
}

// ConsumeWorkflowEvents consumes workflow events from Fluvio
func (c *Client) ConsumeWorkflowEvents(ctx context.Context, handler func(*WorkflowEvent) error) error {
	// Create consumer
	consumer, err := fluvio.NewPartitionConsumer(c.client, c.config.TopicWorkflowEvents, 0)
	if err != nil {
		return fmt.Errorf("failed to create Fluvio consumer: %w", err)
	}
	defer consumer.Close()

	logger.Logger.Info("Started consuming workflow events from Fluvio",
		logger.String("topic", c.config.TopicWorkflowEvents),
	)

	// Create stream
	stream, err := consumer.Stream(fluvio.NewOffset().FromBeginning())
	if err != nil {
		return fmt.Errorf("failed to create stream: %w", err)
	}

	// Consume records
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			record, err := stream.Next()
			if err != nil {
				logger.Logger.Error("Error reading record", logger.Error(err))
				continue
			}

			// Parse event
			var event WorkflowEvent
			if err := json.Unmarshal(record.Value(), &event); err != nil {
				logger.Logger.Error("Failed to unmarshal event", logger.Error(err))
				continue
			}

			// Handle event
			if err := handler(&event); err != nil {
				logger.Logger.Error("Failed to handle event",
					logger.String("workflow_id", event.WorkflowID),
					logger.Error(err),
				)
				continue
			}
		}
	}
}

// Flush flushes any pending messages in the producer
func (c *Client) Flush() error {
	return c.producer.Flush()
}

// Close closes the Fluvio client
func (c *Client) Close() error {
	if c.producer != nil {
		c.producer.Close()
	}
	if c.client != nil {
		c.client.Close()
	}
	return nil
}

