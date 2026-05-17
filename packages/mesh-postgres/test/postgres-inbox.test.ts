import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresInbox } from "../src/postgres-inbox.js";
import type { Message } from "@corelay/mesh-core";
import { startTestPostgres, type TestPostgres } from "./helpers/pg.js";

const msg = (id: string, to: `${string}/${string}`, content = "hi"): Message => ({
  id,
  from: "test/sender",
  to,
  kind: "peer",
  content,
  traceId: "trace-1",
  createdAt: Date.now(),
});

const waitUntil = async (predicate: () => boolean, timeoutMs = 5_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("PostgresInbox (integration)", () => {
  let pg: TestPostgres;

  beforeAll(async () => {
    pg = await startTestPostgres();
  }, 120_000);

  afterAll(async () => {
    if (pg) await pg.stop();
  });

  it("persists appended messages and delivers them via consume", async () => {
    const inbox = new PostgresInbox({
      pool: pg.pool,
      address: "test/a",
      pollIntervalMs: 50,
    });
    const received: string[] = [];
    await inbox.consume(async (m) => {
      received.push(m.content);
    });

    await inbox.append(msg("m-1", "test/a", "first"));
    await inbox.append(msg("m-2", "test/a", "second"));

    await waitUntil(() => received.length === 2);
    await inbox.stop();

    expect(received).toEqual(["first", "second"]);
  });

  it("isolates messages by peer address", async () => {
    const inboxA = new PostgresInbox({
      pool: pg.pool,
      address: "test/iso-a",
      pollIntervalMs: 50,
    });
    const inboxB = new PostgresInbox({
      pool: pg.pool,
      address: "test/iso-b",
      pollIntervalMs: 50,
    });

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    await inboxA.consume(async (m) => {
      receivedA.push(m.content);
    });
    await inboxB.consume(async (m) => {
      receivedB.push(m.content);
    });

    await inboxA.append(msg("iso-1", "test/iso-a", "to-a"));
    await inboxB.append(msg("iso-2", "test/iso-b", "to-b"));
    await inboxA.append(msg("iso-3", "test/iso-a", "to-a-again"));

    await waitUntil(() => receivedA.length === 2 && receivedB.length === 1);
    await inboxA.stop();
    await inboxB.stop();

    expect(receivedA).toEqual(["to-a", "to-a-again"]);
    expect(receivedB).toEqual(["to-b"]);
  });

  it("retries a failed message until a handler succeeds", async () => {
    const address = "test/retry";
    let attempts = 0;
    const inbox = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 50,
    });
    await inbox.consume(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("boom");
    });

    await inbox.append(msg("retry-1", address));

    await waitUntil(() => attempts >= 3);
    await inbox.stop();

    expect(attempts).toBeGreaterThanOrEqual(3);

    // The row should now be marked consumed_at != null.
    const { rows } = await pg.pool.query<{ consumed_at: string | null }>(
      `SELECT consumed_at FROM inbox_messages WHERE id = $1`,
      ["retry-1"],
    );
    expect(rows[0]?.consumed_at).not.toBeNull();
  });

  it("is idempotent on append with the same id", async () => {
    const address = "test/idem";
    const inbox = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 50,
    });
    let count = 0;
    await inbox.consume(async () => {
      count += 1;
    });

    const m = msg("idem-1", address);
    await inbox.append(m);
    await inbox.append(m); // same id, should be a no-op
    await inbox.append(m);

    await waitUntil(() => count >= 1);
    // Give it time to deliver a second one if idempotency is broken.
    await new Promise((r) => setTimeout(r, 300));
    await inbox.stop();

    expect(count).toBe(1);
  });

  it("a restarted consumer picks up unclaimed rows from a crashed predecessor", async () => {
    const address = "test/resume";

    // 1. First "pod" — enqueues three messages but stops without ever consuming
    //    them. This simulates the most common crash shape: messages persisted,
    //    consumer died before processing.
    const crashedProducer = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 50,
    });
    await crashedProducer.append(msg("resume-1", address, "one"));
    await crashedProducer.append(msg("resume-2", address, "two"));
    await crashedProducer.append(msg("resume-3", address, "three"));
    // Crucially: never call consume(). The first pod went away before
    // touching these rows.

    // 2. Second "pod" — starts fresh and consumes the queue.
    const restarted = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 50,
    });
    const received: string[] = [];
    await restarted.consume(async (m) => {
      received.push(m.content);
    });

    await waitUntil(() => received.length === 3);
    await restarted.stop();

    expect(received.sort()).toEqual(["one", "three", "two"]);

    // All rows should now be marked consumed_at != null.
    const { rows } = await pg.pool.query<{ id: string; consumed_at: string | null }>(
      `SELECT id, consumed_at FROM inbox_messages WHERE peer_address = $1 ORDER BY id`,
      [address],
    );
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.consumed_at !== null)).toBe(true);
  });

  it("a new consumer resumes after an in-flight handler was killed mid-processing", async () => {
    const address = "test/resume-midflight";

    // 1. First consumer starts, successfully processes message A, is then
    //    "killed" while message B's handler is still running. We simulate
    //    the kill by stopping the consumer before the handler resolves —
    //    PostgresInbox only marks a row consumed after the handler returns,
    //    so B stays unclaimed.
    const first = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 30,
    });
    await first.append(msg("mid-1", address, "A"));
    await first.append(msg("mid-2", address, "B"));

    const firstReceived: string[] = [];
    let releaseB: (() => void) | undefined;
    const bStarted = new Promise<void>((r) => { releaseB = r; });

    await first.consume(async (m) => {
      firstReceived.push(m.content);
      if (m.content === "B") {
        // Signal that B has entered the handler, then hang — first pod
        // "crashes" before this ever resolves.
        releaseB?.();
        await new Promise(() => { /* never resolves */ });
      }
    });

    await bStarted;
    await first.stop();

    expect(firstReceived).toEqual(["A", "B"]);

    // 2. Second consumer picks up. A is already consumed; B should still
    //    be unclaimed and get redelivered.
    const second = new PostgresInbox({
      pool: pg.pool,
      address,
      pollIntervalMs: 30,
    });
    const secondReceived: string[] = [];
    await second.consume(async (m) => {
      secondReceived.push(m.content);
    });

    await waitUntil(() => secondReceived.length === 1);
    await second.stop();

    expect(secondReceived).toEqual(["B"]);
  });
});
