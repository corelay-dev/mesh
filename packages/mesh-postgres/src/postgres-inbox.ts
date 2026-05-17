import type { Pool } from "pg";
import type {
  Address,
  Inbox,
  Message,
  MessageHandler,
} from "@corelay/mesh-core";

export interface PostgresInboxConfig {
  pool: Pool;
  address: Address;
  /** Polling interval for new messages, in ms. Default 250ms. */
  pollIntervalMs?: number;
  /** Max messages to claim per drain cycle. Default 10. */
  batchSize?: number;
  /** Max retries before moving to DLQ. Default 5. */
  maxRetries?: number;
}

/**
 * Durable Inbox backed by the inbox_messages table.
 *
 * - append() inserts a row.
 * - consume() starts a polling loop that claims unclaimed messages in batch,
 *   invokes the handler, and marks them consumed on success.
 * - On handler failure, retry_count is incremented. After maxRetries,
 *   the message is moved to the dead letter queue (dlq_messages table).
 * - stop() aborts in-flight handlers and resolves once the drain cycle exits.
 */
export class PostgresInbox implements Inbox {
  private readonly pool: Pool;
  private readonly address: Address;
  private readonly pollIntervalMs: number;
  private readonly batchSize: number;
  private readonly maxRetries: number;
  private handler?: MessageHandler;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  private draining: Promise<void> = Promise.resolve();
  private abortController = new AbortController();

  constructor(config: PostgresInboxConfig) {
    this.pool = config.pool;
    this.address = config.address;
    this.pollIntervalMs = config.pollIntervalMs ?? 250;
    this.batchSize = config.batchSize ?? 10;
    this.maxRetries = config.maxRetries ?? 5;
  }

  async append(message: Message): Promise<void> {
    await this.pool.query(
      `INSERT INTO inbox_messages (id, peer_address, payload, created_at, retry_count)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (id) DO NOTHING`,
      [message.id, message.to, JSON.stringify(message), message.createdAt],
    );
  }

  async consume(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.stopped = false;
    this.abortController = new AbortController();
    this.scheduleDrain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abortController.abort();
    if (this.timer) clearTimeout(this.timer);
    // Await the current drain cycle — it will exit quickly because
    // in-flight handlers are aborted via the signal.
    await this.draining;
  }

  private scheduleDrain(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.draining = this.drain().then(() => this.scheduleDrain());
    }, this.pollIntervalMs);
  }

  private async drain(): Promise<void> {
    if (!this.handler || this.stopped) return;

    // Claim a batch of unconsumed messages for this peer
    const { rows } = await this.pool.query<{ id: string; payload: Message; retry_count: number }>(
      `SELECT id, payload, retry_count
       FROM inbox_messages
       WHERE peer_address = $1 AND consumed_at IS NULL AND retry_count < $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [this.address, this.maxRetries, this.batchSize],
    );

    for (const row of rows) {
      if (this.stopped) break;

      const message: Message = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      try {
        // Race the handler against the abort signal
        await this.raceAbort(this.handler(message));
        await this.pool.query(
          `UPDATE inbox_messages SET consumed_at = $1 WHERE id = $2`,
          [Date.now(), row.id],
        );
      } catch (err) {
        // If aborted, leave the message unconsumed for the next consumer
        if (this.abortController.signal.aborted) break;

        // Increment retry count
        const newCount = row.retry_count + 1;
        if (newCount >= this.maxRetries) {
          // Move to DLQ
          await this.pool.query(
            `INSERT INTO dlq_messages (id, peer_address, payload, original_created_at, failed_at, retry_count)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (id) DO NOTHING`,
            [row.id, this.address, JSON.stringify(message), message.createdAt, Date.now(), newCount],
          );
          await this.pool.query(
            `UPDATE inbox_messages SET consumed_at = $1 WHERE id = $2`,
            [Date.now(), row.id],
          );
        } else {
          await this.pool.query(
            `UPDATE inbox_messages SET retry_count = $1 WHERE id = $2`,
            [newCount, row.id],
          );
        }
      }
    }
  }

  private raceAbort<T>(promise: Promise<T>): Promise<T> {
    if (this.abortController.signal.aborted) {
      return Promise.reject(new Error("Consumer aborted"));
    }
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        this.abortController.signal.addEventListener("abort", () => {
          reject(new Error("Consumer aborted"));
        }, { once: true });
      }),
    ]);
  }
}
