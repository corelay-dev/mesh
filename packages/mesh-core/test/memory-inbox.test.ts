import { describe, it, expect } from "vitest";
import { MemoryInbox } from "../src/memory-inbox.js";
import type { Message } from "../src/message.js";

const msg = (id: string, content = "hi"): Message => ({
  id,
  from: "test/sender",
  to: "test/receiver",
  kind: "peer",
  content,
  traceId: "trace-1",
  createdAt: 0,
});

describe("MemoryInbox", () => {
  it("delivers messages appended before consume", async () => {
    const inbox = new MemoryInbox();
    const received: string[] = [];

    await inbox.append(msg("1", "a"));
    await inbox.append(msg("2", "b"));
    await inbox.consume(async (m) => {
      received.push(m.content);
    });

    // Let the microtask queue drain.
    await new Promise((r) => setImmediate(r));

    expect(received).toEqual(["a", "b"]);
  });

  it("delivers messages appended after consume", async () => {
    const inbox = new MemoryInbox();
    const received: string[] = [];

    await inbox.consume(async (m) => {
      received.push(m.content);
    });
    await inbox.append(msg("1", "x"));
    await inbox.append(msg("2", "y"));

    await new Promise((r) => setImmediate(r));

    expect(received).toEqual(["x", "y"]);
  });

  it("preserves append order", async () => {
    const inbox = new MemoryInbox();
    const received: string[] = [];
    await inbox.consume(async (m) => {
      received.push(m.id);
    });

    for (let i = 0; i < 20; i++) {
      await inbox.append(msg(String(i)));
    }
    await new Promise((r) => setImmediate(r));

    expect(received).toEqual(Array.from({ length: 20 }, (_, i) => String(i)));
  });

  it("continues delivering after a handler throws", async () => {
    const inbox = new MemoryInbox();
    const received: string[] = [];
    await inbox.consume(async (m) => {
      if (m.id === "2") throw new Error("boom");
      received.push(m.id);
    });

    await inbox.append(msg("1"));
    await inbox.append(msg("2"));
    await inbox.append(msg("3"));
    await new Promise((r) => setImmediate(r));

    expect(received).toEqual(["1", "3"]);
  });
});
