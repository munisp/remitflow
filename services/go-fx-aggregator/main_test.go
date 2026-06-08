package main

import (
	"testing"
	"time"
)

func TestNewRateCache(t *testing.T) {
	cache := NewRateCache(5 * time.Minute)
	if cache == nil {
		t.Fatal("NewRateCache returned nil")
	}
	all := cache.All()
	if len(all) != 0 {
		t.Errorf("expected empty cache, got %d entries", len(all))
	}
}

func TestRateCacheSetGet(t *testing.T) {
	cache := NewRateCache(5 * time.Minute)
	rate := AggregatedRate{
		Pair: "USD-NGN",
		Rate: 1580.50,
		Sources: []RateEntry{
			{Rate: 1580.50, Source: "test_source", FetchedAt: time.Now()},
		},
		Timestamp: time.Now(),
	}
	cache.Set("USD-NGN", rate)

	got, ok := cache.Get("USD-NGN")
	if !ok {
		t.Fatal("expected to find USD-NGN rate")
	}
	if got.Rate != 1580.50 {
		t.Errorf("expected rate 1580.50, got %f", got.Rate)
	}
	if got.Pair != "USD-NGN" {
		t.Errorf("expected pair USD-NGN, got %s", got.Pair)
	}
}

func TestRateCacheAll(t *testing.T) {
	cache := NewRateCache(5 * time.Minute)
	cache.Set("USD-NGN", AggregatedRate{Pair: "USD-NGN", Rate: 1580.50, Timestamp: time.Now()})
	cache.Set("USD-GHS", AggregatedRate{Pair: "USD-GHS", Rate: 15.20, Timestamp: time.Now()})
	cache.Set("USD-KES", AggregatedRate{Pair: "USD-KES", Rate: 153.50, Timestamp: time.Now()})

	all := cache.All()
	if len(all) != 3 {
		t.Errorf("expected 3 rates, got %d", len(all))
	}
}

func TestRateCacheTTL(t *testing.T) {
	cache := NewRateCache(50 * time.Millisecond)
	cache.Set("USD-NGN", AggregatedRate{Pair: "USD-NGN", Rate: 1580.50, Timestamp: time.Now()})

	_, ok := cache.Get("USD-NGN")
	if !ok {
		t.Fatal("expected rate before TTL")
	}

	time.Sleep(60 * time.Millisecond)
	_, ok = cache.Get("USD-NGN")
	if ok {
		t.Error("expected rate to expire after TTL")
	}
}

func TestAggregateRatesMedian(t *testing.T) {
	entries := []RateEntry{
		{Rate: 1580.0, Source: "s1"},
		{Rate: 1585.0, Source: "s2"},
		{Rate: 1590.0, Source: "s3"},
	}
	result := aggregateRates(entries)
	// Median of [1580, 1585, 1590] = 1585
	if result != 1585.0 {
		t.Errorf("expected median 1585, got %f", result)
	}
}

func TestAggregateRatesSingle(t *testing.T) {
	entries := []RateEntry{{Rate: 1580.0, Source: "s1"}}
	result := aggregateRates(entries)
	if result != 1580.0 {
		t.Errorf("expected 1580, got %f", result)
	}
}

func TestAggregateRatesEmpty(t *testing.T) {
	result := aggregateRates(nil)
	if result != 0 {
		t.Errorf("expected 0 for empty input, got %f", result)
	}
}

func TestCalculateSpread(t *testing.T) {
	entries := []RateEntry{
		{Rate: 1580.0},
		{Rate: 1590.0},
	}
	spread := calculateSpread(entries)
	if spread <= 0 {
		t.Errorf("spread should be positive, got %f", spread)
	}
	// Spread = (1590 - 1580) / 1585 * 100 ≈ 0.631%
	expected := (1590.0 - 1580.0) / 1585.0 * 100
	if spread < expected-0.1 || spread > expected+0.1 {
		t.Errorf("expected spread ~%.3f%%, got %.3f%%", expected, spread)
	}
}

func TestCalculateSpreadSingle(t *testing.T) {
	entries := []RateEntry{{Rate: 1580.0}}
	spread := calculateSpread(entries)
	if spread != 0 {
		t.Errorf("spread of single entry should be 0, got %f", spread)
	}
}
