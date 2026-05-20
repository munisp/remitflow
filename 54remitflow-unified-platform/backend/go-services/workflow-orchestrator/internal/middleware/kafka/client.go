package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"workflow-orchestrator/pkg/logger"
	"workflow-orchestrator/pkg/metrics"
)

// Client represents a Kafka client for workflow events
type Client struct {
	producer *kafka.Producer
	consumer *kafka.Consumer
	config   *Config
}

// Config holds Kafka configuration
type Config struct {
	Brokers              []string
	TopicWorkflowEvents  string
	TopicWorkflowTasks   string
	ConsumerGroup        string
	EnableAutoCommit     bool
	SessionTimeoutMs     int
	MaxPollIntervalMs    int
}

// WorkflowEvent represents a workflow lifecycle event
type WorkflowEvent struct {
	EventID     string                 `json:"event_id"`
	EventType   string                 `json:"event_type"`
	Timestamp   time.Time              `json:"timestamp"`
	WorkflowID  string                 `json:"workflow_id"`
	WorkflowType string                `json:"workflow_type"`
	Status      string                 `json:"status"`
	TenantID    string                 `json:"tenant_id"`
	UserID      string                 `json:"user_id"`
	Data        map[string]interface{} `json:"data"`
}

// NewClient creates a new Kafka client
func NewClient(config *Config) (*Client, error) {
	// Create producer
	producer, err := kafka.NewProducer(&kafka.ConfigMap{
		"bootstrap.servers": joinBrokers(config.Brokers),
		"acks":              "all",
		"retries":           3,
		"max.in.flight.requests.per.connection": 5,
		"compression.type":  "snappy",
		"linger.ms":         10,
		"batch.size":        16384,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Kafka producer: %w", err)
	}

	// Create consumer
	consumer, err := kafka.NewConsumer(&kafka.ConfigMap{
		"bootstrap.servers":  joinBrokers(config.Brokers),
		"group.id":           config.ConsumerGroup,
		"auto.offset.reset":  "earliest",
		"enable.auto.commit": config.EnableAutoCommit,
		"session.timeout.ms": config.SessionTimeoutMs,
		"max.poll.interval.ms": config.MaxPollIntervalMs,
	})
	if err != nil {
		producer.Close()
		return nil, fmt.Errorf("failed to create Kafka consumer: %w", err)
	}

	return &Client{
		producer: producer,
		consumer: consumer,
		config:   config,
	}, nil
}

// PublishWorkflowEvent publishes a workflow lifecycle event to Kafka
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

	// Create Kafka message
	msg := &kafka.Message{
		TopicPartition: kafka.TopicPartition{
			Topic:     &c.config.TopicWorkflowEvents,
			Partition: kafka.PartitionAny,
		},
		Key:   []byte(event.WorkflowID),
		Value: data,
		Headers: []kafka.Header{
			{Key: "event_type", Value: []byte(event.EventType)},
			{Key: "workflow_type", Value: []byte(event.WorkflowType)},
		},
	}

	// Produce message asynchronously
	deliveryChan := make(chan kafka.Event)
	err = c.producer.Produce(msg, deliveryChan)
	if err != nil {
		metrics.EventsPublished.WithLabelValues(c.config.TopicWorkflowEvents, "error").Inc()
		return fmt.Errorf("failed to produce message: %w", err)
	}

	// Wait for delivery report
	select {
	case e := <-deliveryChan:
		m := e.(*kafka.Message)
		if m.TopicPartition.Error != nil {
			metrics.EventsPublished.WithLabelValues(c.config.TopicWorkflowEvents, "error").Inc()
			return fmt.Errorf("delivery failed: %w", m.TopicPartition.Error)
		}
		logger.Logger.Info("Event published to Kafka",
			logger.String("topic", *m.TopicPartition.Topic),
			logger.Int("partition", int(m.TopicPartition.Partition)),
			logger.String("workflow_id", event.WorkflowID),
			logger.Duration("duration", time.Since(start)),
		)
	case <-ctx.Done():
		return ctx.Err()
	}

	return nil
}

// PublishWorkflowTask publishes a workflow task to Kafka for asynchronous processing
func (c *Client) PublishWorkflowTask(ctx context.Context, task map[string]interface{}) error {
	data, err := json.Marshal(task)
	if err != nil {
		return fmt.Errorf("failed to marshal task: %w", err)
	}

	msg := &kafka.Message{
		TopicPartition: kafka.TopicPartition{
			Topic:     &c.config.TopicWorkflowTasks,
			Partition: kafka.PartitionAny,
		},
		Value: data,
	}

	deliveryChan := make(chan kafka.Event)
	err = c.producer.Produce(msg, deliveryChan)
	if err != nil {
		return fmt.Errorf("failed to produce task: %w", err)
	}

	select {
	case e := <-deliveryChan:
		m := e.(*kafka.Message)
		if m.TopicPartition.Error != nil {
			return fmt.Errorf("task delivery failed: %w", m.TopicPartition.Error)
		}
	case <-ctx.Done():
		return ctx.Err()
	}

	return nil
}

// ConsumeWorkflowEvents consumes workflow events from Kafka
func (c *Client) ConsumeWorkflowEvents(ctx context.Context, handler func(*WorkflowEvent) error) error {
	// Subscribe to topic
	err := c.consumer.SubscribeTopics([]string{c.config.TopicWorkflowEvents}, nil)
	if err != nil {
		return fmt.Errorf("failed to subscribe to topic: %w", err)
	}

	logger.Logger.Info("Started consuming workflow events from Kafka",
		logger.String("topic", c.config.TopicWorkflowEvents),
		logger.String("group", c.config.ConsumerGroup),
	)

	// Consume messages
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			msg, err := c.consumer.ReadMessage(100 * time.Millisecond)
			if err != nil {
				if err.(kafka.Error).Code() == kafka.ErrTimedOut {
					continue
				}
				logger.Logger.Error("Error reading message", logger.Error(err))
				continue
			}

			// Parse event
			var event WorkflowEvent
			if err := json.Unmarshal(msg.Value, &event); err != nil {
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

			// Commit offset
			if !c.config.EnableAutoCommit {
				_, err = c.consumer.CommitMessage(msg)
				if err != nil {
					logger.Logger.Error("Failed to commit offset", logger.Error(err))
				}
			}
		}
	}
}

// Flush flushes any pending messages in the producer
func (c *Client) Flush(timeout time.Duration) {
	remaining := c.producer.Flush(int(timeout.Milliseconds()))
	if remaining > 0 {
		logger.Logger.Warn("Failed to flush all messages",
			logger.Int("remaining", remaining),
		)
	}
}

// Close closes the Kafka client
func (c *Client) Close() error {
	c.producer.Close()
	return c.consumer.Close()
}

// Helper function to join broker addresses
func joinBrokers(brokers []string) string {
	result := ""
	for i, broker := range brokers {
		if i > 0 {
			result += ","
		}
		result += broker
	}
	return result
}

