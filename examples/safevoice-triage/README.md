# safevoice-triage

**Week 2 acceptance gate** — SafeVoice triage end-to-end on Corelay Mesh.

Demonstrates every Week 2 primitive composed into one flow:

- **Agent** + **LLMRouter** (primary OpenAI → Anthropic fallback)
- **Hierarchy** via `managerPeer` delegating to safety-planner and service-finder agents
- **Critic** via `withCritic` reviewing the merged reply against safeguarding guardrails
- **WhatsApp channel** via `handleWebhook` + auto-registered `UserPeer`
- **HumanPeer** caseworker worklist + escalation for the high-risk path
- **OpenTelemetry** — every span printed to stdout with the full parent chain

## Running

You need at least one LLM provider configured:

```bash
export OPENAI_API_KEY=sk-...
# optional second provider for fallback:
export ANTHROPIC_API_KEY=sk-ant-...

# Optionally override the model:
export MODEL=gpt-4o-mini
```

Two scenarios:

```bash
# normal risk — agent society answers through hierarchy + critic
npm start

# high risk — HumanPeer caseworker receives + acts
npm start:high-risk
```

## What the normal-risk scenario does

1. A simulated user sends *"I'm worried about my safety at home…"* via WhatsApp.
2. `handleWebhook` parses the Meta-shaped payload, auto-registers a `UserPeer` for the sender, and delivers the inbound to the manager agent.
3. `managerPeer` decomposes via `LLMDecomposer`, dispatches sub-tasks in parallel to the safety-planner and service-finder agents.
4. Workers reply to the manager's collector; `LLMMerger` combines.
5. The merged reply routes to the critic-peer (`coordination.critic`) which checks it against the triage guardrails. Revises if needed.
6. The final text goes to the `UserPeer` which would POST to Meta's API — in this demo, the outbound is captured by a stubbed `fetch`.

## What the high-risk scenario does

1. User says something flagged by `isHighRisk` (keyword classifier — real SafeVoice uses a proper classifier).
2. Instead of the manager, the inbound targets the caseworker's `HumanPeer`.
3. The caseworker sees the item in their worklist.
4. The demo simulates the caseworker posting an `edit` decision with the canonical domestic-abuse Silent Solution guidance (999 + press 55).
5. The edited content is delivered back through the user's `UserPeer` to (simulated) WhatsApp.

Escalation is wired: if no caseworker responds within 5 minutes, `HumanPeer` auto-delivers a rejection signposting the emergency numbers so the user isn't silenced.

## What's NOT in this example (yet)

- A real HTTP server. The harness drives `handleWebhook` directly.
- A real Meta deployment. The outbound `fetch` is stubbed.
- `PostgresInbox` / workflow persistence. Uses `MemoryInbox` so the demo doesn't need a database.
- Real safeguarding prompts. Real SafeVoice prompts are long, tenant-specific, and reviewed by practitioners.

Wiring a production HTTP server + real Postgres + real Meta is a one-day job on top of this example — the core architecture is all here.

## What the logs look like

Running either scenario prints:
- OTel spans as they end (child spans first, then parents), with the full trace and parent-span ids.
- The simulated WhatsApp outbound payloads at the end.
