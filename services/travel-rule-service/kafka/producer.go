package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

type Producer struct {
	writers map[string]*kafka.Writer
	brokers []string
	logger  *zap.Logger
}

func NewProducer(brokers []string, logger *zap.Logger) *Producer {
	return &Producer{
		writers: make(map[string]*kafka.Writer),
		brokers: brokers,
		logger:  logger,
	}
}

func (p *Producer) getWriter(topic string) *kafka.Writer {
	if w, ok := p.writers[topic]; ok {
		return w
	}
	w := &kafka.Writer{
		Addr:         kafka.TCP(p.brokers...),
		Topic:        topic,
		Balancer:     &kafka.LeastBytes{},
		RequiredAcks: kafka.RequireAll,
		Async:        false,
		Compression:  kafka.Snappy,
		WriteTimeout: 10 * time.Second,
		ReadTimeout:  10 * time.Second,
	}
	p.writers[topic] = w
	return w
}

func (p *Producer) Publish(ctx context.Context, topic, key string, payload interface{}) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	msg := kafka.Message{
		Key:   []byte(key),
		Value: data,
		Headers: []kafka.Header{
			{Key: "service", Value: []byte("travel-rule-service")},
			{Key: "timestamp", Value: []byte(time.Now().UTC().Format(time.RFC3339))},
		},
	}

	writer := p.getWriter(topic)
	if err := writer.WriteMessages(ctx, msg); err != nil {
		p.logger.Error("failed to publish kafka message",
			zap.String("topic", topic),
			zap.String("key", key),
			zap.Error(err),
		)
		return err
	}

	p.logger.Debug("published kafka message",
		zap.String("topic", topic),
		zap.String("key", key),
	)
	return nil
}

func (p *Producer) Close() {
	for topic, w := range p.writers {
		if err := w.Close(); err != nil {
			p.logger.Error("failed to close kafka writer", zap.String("topic", topic), zap.Error(err))
		}
	}
}
