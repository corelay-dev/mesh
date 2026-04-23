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
}

/**
 * Durable Inbox backed by the inbox_messages table.
 *
 * append() inserts a row; consume() starts a polling loop that claims
 * unclaimed messages in order, invokes the handler, and marks them
 * consumed only if the handler succeeds. If the handler throws the row
 * stays unclaimed so another pod (or the next poll) can retry.
 *
 * Day 5 scope: polling-based consumer, single-consumer-per-address.
 * LISTEN/NOTIFY push and SELECT FOR UPDATE SKIP LOCKED multi-consumer
 * claims land when we need them.
 */
export class PostgresInbox implements Inbox {
  private readonly pool: Pool;
  private readonly address: Address;
  private readonly pollIntervalMs: number;
  private handler?: MessageHandler;
  private stopped = false;
  private timer?: NodeJS.Timeout;

  constructor(config: PostgresInboxConfig) {
    this.pool = config.pool;
    this.address = config.address;
    this.pollIntervalMs = config.pollIntervalMs ?? 250;
  }

  async append(message: Message): Promise<void> {
    await this.pool.query(
      `INSERT INTO inbox_messages (id, peer_address, payload, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [message.id, message.to, JSON.stringify(message), message.createdAt],
    );
  }

  async consume(handler: MessageHandler): Promise<void> {
    this.handler = handler;
    this.stopped = false;
    this.scheduleDrain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleDrain(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.drain().then(() => this.scheduleDrain());
    }, this.pollIntervalMs);
  }

  private async drain(): Promise<void> {
    if (!this.handler || this.stopped) return;

    // Claim the oldest unconsumed message for this peer.
    const { rows } = await this.pool.query<{ id: string; payload: Message }>(
      `SELECT id, payload
       FROM inbox_messages
       WHERE peer_address = $1 AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [this.address],
    );
    const row = rows[0];
    if (!row) return;

    try {
      await this.handler(row.payload);
      await this.pool.query(
        `UPDATE inbox_messages SET consumed_at = $1 WHERE id = $2`,
        [Date.now(), row.id],
      );
    } catch {
      // Leave unclaimed. The next drain picks it up; production ops
      // would cap retries and route to a DLQ table.
    }
  }
}
