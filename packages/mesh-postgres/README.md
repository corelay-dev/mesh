# @corelay/mesh-postgres

Postgres durability layer for [Corelay Mesh](https://github.com/corelay-dev/mesh) — durable workflow store, inbox, and stale-workflow sweeper.

## Install

```bash
npm install @corelay/mesh-postgres pg
psql "$DATABASE_URL" -f node_modules/@corelay/mesh-postgres/sql/001-init.sql
```

## Usage

### WorkflowStore

Implements `WorkflowRecorder` from `@corelay/mesh-core`. Pass to `run()` to persist workflows.

```ts
import { Pool } from "pg";
import { WorkflowStore } from "@corelay/mesh-postgres";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const store = new WorkflowStore({ pool });

const workflow = await store.createWorkflow("peer:orchestrator");
await store.appendEvent(workflow.id, "step:started", { step: "validate" });
await store.updateStatus(workflow.id, "completed");
```

### PostgresInbox

Durable per-peer inbox. Polls for unclaimed messages; rows stay unclaimed on handler failure for automatic retry.

```ts
import { PostgresInbox } from "@corelay/mesh-postgres";

const inbox = new PostgresInbox({ pool, address: "peer:worker-1", pollIntervalMs: 500 });
await inbox.consume(async (message) => { /* handle message */ });
await inbox.stop();
```

### sweepStaleWorkflows

Marks long-stuck `running` workflows as `failed` — recovers from crashed pods. Safe to run concurrently across replicas.

```ts
import { sweepStaleWorkflows } from "@corelay/mesh-postgres";

const { swept } = await sweepStaleWorkflows({ pool, olderThanMs: 5 * 60_000, limit: 100 });
```

## Schema

[`sql/001-init.sql`](./sql/001-init.sql) — `workflows`, `workflow_events`, `inbox_messages`. Timestamps are epoch-millis `BIGINT`.

## License

[MIT](../../LICENSE) © Corelay Ltd
