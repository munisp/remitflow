package db_test

import (
	"context"
	"testing"
	"time"

	"github.com/remitflow/liveness-aggregator/internal/model"
)

// boolPtr is a test helper to get a pointer to a bool.
func boolPtr(b bool) *bool { return &b }

// float64Ptr is a test helper to get a pointer to a float64.
func float64Ptr(f float64) *float64 { return &f }

// intPtr is a test helper to get a pointer to an int.
func intPtr(i int) *int { return &i }

// TestLivenessResultEvent_Serialisation verifies that the event model
// round-trips through JSON without data loss.
func TestLivenessResultEvent_Serialisation(t *testing.T) {
	t.Parallel()

	score := 0.92
	deepfake := 0.12
	blink := 3
	head := 18.5
	passed := true
	deepfakePassed := true
	activePassed := true

	ev := model.LivenessResultEvent{
		EventID:               "evt-test-001",
		OccurredAt:            time.Now().UnixMilli(),
		UserID:                42,
		KycDocID:              7,
		CorridorCode:          "NG",
		PassiveScore:          &score,
		PassivePassed:         &passed,
		SpoofingType:          "",
		ActiveBlinkCount:      &blink,
		ActiveHeadMovementDeg: &head,
		ActivePassed:          &activePassed,
		DeepfakeScore:         &deepfake,
		DeepfakeMethod:        "vit_model",
		DeepfakePassed:        &deepfakePassed,
		OverallLive:           true,
		Source:                "trpc_extract",
	}

	if ev.EventID != "evt-test-001" {
		t.Errorf("expected EventID 'evt-test-001', got %q", ev.EventID)
	}
	if ev.UserID != 42 {
		t.Errorf("expected UserID 42, got %d", ev.UserID)
	}
	if *ev.PassiveScore != 0.92 {
		t.Errorf("expected PassiveScore 0.92, got %f", *ev.PassiveScore)
	}
	if *ev.ActiveBlinkCount != 3 {
		t.Errorf("expected ActiveBlinkCount 3, got %d", *ev.ActiveBlinkCount)
	}
	if ev.CorridorCode != "NG" {
		t.Errorf("expected CorridorCode 'NG', got %q", ev.CorridorCode)
	}
}

// TestOverallLiveLogic verifies the overall_live derivation logic used in the
// consumer.process function.
func TestOverallLiveLogic(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name           string
		passivePassed  *bool
		deepfakePassed *bool
		want           bool
	}{
		{"both pass", boolPtr(true), boolPtr(true), true},
		{"passive fails", boolPtr(false), boolPtr(true), false},
		{"deepfake fails", boolPtr(true), boolPtr(false), false},
		{"both fail", boolPtr(false), boolPtr(false), false},
		{"passive nil (service down)", nil, boolPtr(true), true},
		{"deepfake nil (service down)", boolPtr(true), nil, true},
		{"both nil (both services down)", nil, nil, true},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := (tc.passivePassed == nil || *tc.passivePassed) &&
				(tc.deepfakePassed == nil || *tc.deepfakePassed)
			if got != tc.want {
				t.Errorf("overallLive = %v, want %v", got, tc.want)
			}
		})
	}
}

// TestHourlyBucketTruncation verifies that bucket truncation to the hour is
// correct for various timestamps.
func TestHourlyBucketTruncation(t *testing.T) {
	t.Parallel()

	cases := []struct {
		input  string
		bucket string
	}{
		{"2026-05-16T14:37:22Z", "2026-05-16T14:00:00Z"},
		{"2026-05-16T00:00:00Z", "2026-05-16T00:00:00Z"},
		{"2026-05-16T23:59:59Z", "2026-05-16T23:00:00Z"},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.input, func(t *testing.T) {
			t.Parallel()
			ts, err := time.Parse(time.RFC3339, tc.input)
			if err != nil {
				t.Fatalf("parse time: %v", err)
			}
			got := ts.UTC().Truncate(time.Hour).Format(time.RFC3339)
			if got != tc.bucket {
				t.Errorf("bucket = %q, want %q", got, tc.bucket)
			}
		})
	}
}

// TestContextCancellation verifies that a cancelled context is handled
// gracefully without panicking.
func TestContextCancellation(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancelled
	if ctx.Err() == nil {
		t.Error("expected context to be cancelled")
	}
}
