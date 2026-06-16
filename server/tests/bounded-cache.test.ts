/**
 * BoundedCache Business Logic Tests
 * Tests: LRU eviction, TTL expiry, metrics, capacity enforcement
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { BoundedCache } from "../lib/boundedCache";

describe("BoundedCache", () => {
  let cache: BoundedCache<string, string>;

  beforeEach(() => {
    cache = new BoundedCache({ maxSize: 3, defaultTtlMs: 60_000, name: "test" });
  });

  it("should store and retrieve values", () => {
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("should return undefined for missing keys", () => {
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("should evict oldest entry when capacity exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    // Cache full (3 items). Adding a 4th should evict "a" (oldest)
    cache.set("d", "4");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.get("d")).toBe("4");
  });

  it("should expire entries after TTL", () => {
    vi.useFakeTimers();
    const shortCache = new BoundedCache<string, string>({
      maxSize: 10,
      defaultTtlMs: 1000,
      name: "ttl-test",
    });
    shortCache.set("key", "value");
    expect(shortCache.get("key")).toBe("value");

    vi.advanceTimersByTime(1001);
    expect(shortCache.get("key")).toBeUndefined();
    vi.useRealTimers();
  });

  it("should support custom TTL per entry", () => {
    vi.useFakeTimers();
    cache.set("short", "val", 500);
    cache.set("long", "val", 5000);

    vi.advanceTimersByTime(600);
    expect(cache.get("short")).toBeUndefined(); // expired
    expect(cache.get("long")).toBe("val"); // still valid
    vi.useRealTimers();
  });

  it("should update LRU position on access", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    // Access "a" to make it recently used
    cache.get("a");
    // Add new entry — should evict "b" (now oldest), not "a"
    cache.set("d", "4");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBeUndefined();
  });

  it("should overwrite existing key and reset LRU position", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    // Overwrite "a" — should move it to most recent
    cache.set("a", "updated");
    cache.set("d", "4");
    expect(cache.get("a")).toBe("updated");
    expect(cache.get("b")).toBeUndefined(); // evicted
  });

  it("should track hit/miss metrics", () => {
    cache.set("x", "1");
    cache.get("x"); // hit
    cache.get("x"); // hit
    cache.get("missing"); // miss
    const metrics = cache.getMetrics();
    expect(metrics.hits).toBe(2);
    expect(metrics.misses).toBe(1);
    expect(metrics.hitRate).toBe("66.67%");
  });

  it("should return correct size", () => {
    expect(cache.size).toBe(0);
    cache.set("a", "1");
    cache.set("b", "2");
    expect(cache.size).toBe(2);
  });

  it("should delete entries", () => {
    cache.set("a", "1");
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("should clear all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});
