import { describe, it, expect, vi } from "vitest";
import { ScanCache } from "../src/harvester/cache.js";

describe("ScanCache", () => {
  it("stores and retrieves values", () => {
    const cache = new ScanCache<string>();
    cache.set("key1", "value1", 10000);
    expect(cache.get("key1")).toBe("value1");
  });

  it("has returns true for existing keys", () => {
    const cache = new ScanCache<string>();
    cache.set("key1", "value1", 10000);
    expect(cache.has("key1")).toBe(true);
  });

  it("has returns false for missing keys", () => {
    const cache = new ScanCache<string>();
    expect(cache.has("missing")).toBe(false);
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new ScanCache<string>();
    cache.set("key1", "value1", 100);
    expect(cache.has("key1")).toBe(true);

    vi.advanceTimersByTime(101);
    expect(cache.has("key1")).toBe(false);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("get returns undefined for expired entries", () => {
    vi.useFakeTimers();
    const cache = new ScanCache<number>();
    cache.set("num", 42, 50);
    vi.advanceTimersByTime(51);
    expect(cache.get("num")).toBeUndefined();
    vi.useRealTimers();
  });

  it("overwrites existing keys", () => {
    const cache = new ScanCache<string>();
    cache.set("key", "first", 10000);
    cache.set("key", "second", 10000);
    expect(cache.get("key")).toBe("second");
  });
});
