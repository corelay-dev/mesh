# @corelay/agent

Zero-dependency telemetry SDK for AI products. Reports health, errors, custom metrics, LLM usage (OpenAI, Anthropic, Bedrock), and HTTP request metrics to a Corelay Command Centre over plain HTTP. Designed to survive transport failures without blocking the main thread.

```bash
npm install @corelay/agent
```

Requires Node.js 18+. TypeScript-native. No runtime dependencies.

---

## Why it exists

Production AI services accumulate observability requirements quickly: health checks, cost tracking per provider and feature, structured errors, request-level metrics, LLM call latency. Most existing tools solve one of these well and the rest badly, and charge per seat per month.

`@corelay/agent` is the opposite. One `init()` call, five overlapping concerns covered, batched transport with cap-and-drop on failure, zero dependencies to audit.

---

## Quick start

```ts
import { init } from '@corelay/agent';

const agent = init({
  commandCenterUrl: 'https://your-command-centre.example.com',
  productId: 'your-service-name',
  apiKey: process.env.CORELAY_API_KEY,
});

agent.start();
```

That's it. By default:

- Heartbeats flush every 30s with uptime + memory
- Uncaught exceptions and unhandled promise rejections are captured
- Metrics and telemetry batches flush every 10s over HTTP
- A graceful `stop()` drains the final batch

---

## Express middleware

```ts
app.use(agent.expressMiddleware());
```

Tracks method, path, status code, and duration of every request. Aggregated at the Command Centre into P50 / P95 / P99 latency per route.

---

## LLM tracking

### Bedrock (auto-tracking)

```ts
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const raw = new BedrockRuntimeClient({ region: 'eu-west-2' });
const bedrock = agent.wrapBedrock(raw);

// Every InvokeModel / Converse call is now tracked automatically.
// The wrapper preserves the original client's type signature.
```

### OpenAI (auto-tracking)

```ts
import OpenAI from 'openai';

const raw = new OpenAI();
const openai = agent.wrapOpenAI(raw);

// chat.completions.create calls are tracked automatically.
```

### Manual tracking

```ts
agent.trackLLM(
  'anthropic',      // provider
  'claude-sonnet-4', // model
  inputTokens,
  outputTokens,
  costUsd,
  durationMs,
  'summarise-case'  // feature tag (optional)
);
```

Costs accumulate at the Command Centre per product, per provider, per feature — useful for attributing LLM spend to individual product features.

---

## Error tracking

Uncaught exceptions and unhandled rejections are captured automatically. For manual tracking:

```ts
agent.trackError(new Error('payment webhook failed'), { userId: 'u_123' });
```

Errors are batched with a local cap so a flood of errors can't blow up memory.

---

## Custom metrics

```ts
agent.trackMetric('queue.depth', 42, { queue: 'emails' });
agent.trackMetric('safevoice.triage.latency_ms', 1234, { tenant: 'uk' });
```

Any numeric value with arbitrary tags. The Command Centre aggregates by name and tags.

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `commandCenterUrl` | `string` | required | Base URL of your Command Centre deployment |
| `productId` | `string` | required | Unique identifier for this service |
| `apiKey` | `string` | — | Bearer token for authenticated Command Centre |
| `heartbeatInterval` | `number` | `30000` | Health report cadence in ms |
| `flushInterval` | `number` | `10000` | Metrics/errors/LLM batch flush cadence in ms |
| `enabled` | `boolean` | `true` | Set `false` to noop everything (useful in tests) |

---

## Design choices

- **Zero runtime dependencies.** Nothing to audit, no supply-chain surprises. Pure TypeScript built to dual ESM + CJS output.
- **Batched HTTP transport with drop-on-failure.** If the Command Centre is down, metrics are dropped rather than queued unboundedly. An in-memory cap prevents error floods from exhausting heap.
- **Non-blocking timers.** Flush timers use `.unref()` so they don't keep the process alive on shutdown.
- **Type-preserving LLM wrappers.** `wrapBedrock<T extends object>(client: T): T` returns the same type as the input. Instrumentation is invisible at the type level.
- **Product-agnostic.** One SDK, any Node.js service. Used today in five production AI products (SafeVoice, Endorsd, Keepa, Corelay VIP, BuildWithAI).

---

## Architecture

```
┌──────────────────────────────────────────┐
│            Your Node.js Service            │
│                                            │
│  ┌────────────────────────────────────┐  │
│  │       @corelay/agent               │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │ HealthCollector (30s timer)  │ │  │
│  │  │ ErrorCollector (hooks proc)  │ │  │
│  │  │ LLMTracker (wraps clients)   │ │  │
│  │  │ RequestTracker (middleware)  │ │  │
│  │  └──────────────────────────────┘ │  │
│  │             │                      │  │
│  │             ▼                      │  │
│  │  ┌──────────────────────────────┐ │  │
│  │  │ HttpTransport (batched POST) │ │  │
│  │  └──────────────────────────────┘ │  │
│  └────────────────────────────────────┘  │
└────────────────────┬────────────────────┘
                     │  POST /telemetry (every flushInterval)
                     ▼
       ┌──────────────────────────────┐
       │     Corelay Command Centre    │
       │  (aggregation, dashboards,    │
       │   AI-assisted diagnosis)      │
       └──────────────────────────────┘
```

Source layout:

```
src/
├── collectors/
│   ├── health.ts        # Heartbeats
│   ├── errors.ts        # Uncaught + manual errors
│   ├── llm.ts           # Bedrock + OpenAI wrappers, manual tracking
│   └── requests.ts      # Express middleware
├── transports/
│   └── http.ts          # Batched HTTP POST with retry backoff
├── types.ts             # All public types
├── register.ts          # One-time registration handshake
└── index.ts             # Public API
```

---

## Graceful shutdown

```ts
process.on('SIGTERM', async () => {
  await agent.stop(); // Flushes final batch, clears timers
  process.exit(0);
});
```

---

## Production use

`@corelay/agent` is embedded in every Corelay-managed product:

- **SafeVoice** — AI crisis response for DA/GBV survivors (UK + Nigeria)
- **Endorsd** — AI advisor for UK Global Talent Visa applicants
- **Keepa** — ML credit scoring for informal-economy traders
- **Corelay VIP** — vehicle intelligence for Nigeria (Apache Flink CEP)
- **BuildWithAI** — AI school for non-technical Nigerian learners

Each product sends telemetry to a shared Corelay Command Centre, which provides cross-product observability and AI-assisted incident diagnosis.

---

## Contributing

Contributions welcome. See `CONTRIBUTING.md`.

## License

MIT — see `LICENSE`.

© 2026 Corelay Ltd (UK).
