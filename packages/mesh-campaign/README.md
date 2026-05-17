# @corelay/mesh-campaign

Campaign domain agents for [Corelay Mesh](https://github.com/corelay-dev/mesh) — narrative generation, intelligence analysis, strategy, compliance review, and election-day war room.

## Install

```bash
npm install @corelay/mesh-campaign
```

ESM-only. Requires Node 20+.

## Quick Start

```ts
import { PeerRegistry, MemoryInbox, run, type Address } from "@corelay/mesh-core";
import { createNarrativeAgent, createComplianceAgent, MemoryContextStore } from "@corelay/mesh-campaign";

const registry = new PeerRegistry();
const contextStore = new MemoryContextStore();
contextStore.set("campaign-uuid", {
  candidateProfile: ["Alhaji Musa — PDP, Gombe State"],
  keyPolicies: ["Road infrastructure", "Education"],
  donts: ["Do not attack opponent's family"],
  brandVoice: null,
  learnedRules: [],
  historicalPerformance: [],
});

const narrative = createNarrativeAgent({ registry, llm, contextStore });
const compliance = createComplianceAgent({ registry, llm, contextStore });
registry.register(narrative);
registry.register(compliance);
await narrative.start();
await compliance.start();

const { content } = await run(
  registry,
  "campaign/narrative" as Address,
  JSON.stringify({ kind: "generate", campaignId: "campaign-uuid", task: "Rally announcement", channel: "twitter", language: "en" }),
);
console.log(JSON.parse(content)); // [{ content: "...", tone: "...", targetAudience: "..." }]
```

## Agents

| Address | Factory | Description |
|---------|---------|-------------|
| `campaign/narrative` | `createNarrativeAgent` | Generates campaign messages in EN/YO/HA/IG/PCM across all channels |
| `campaign/intel` | `createIntelAgent` | Sentiment analysis, opponent tracking, daily briefs |
| `campaign/strategy` | `createStrategyAgent` | Ward-by-ward targeting based on historical data |
| `campaign/research` | `createResearchAgent` | Fact-checks claims before publishing |
| `campaign/compliance` | `createComplianceAgent` | Electoral law + hate speech + LLM review |

## Workflows

### Messaging Workflow

Generate → Compliance review → Score. Returns messages ready for approval.

```ts
import { runMessagingWorkflow } from "@corelay/mesh-campaign";

const result = await runMessagingWorkflow({
  registry, campaignId, task: "Announce new policy", channel: "whatsapp", language: "pcm", count: 3,
});
// result.messages[0].compliance.passed === true
```

### Rapid Response

Intel trigger → Research verifies → Narrative counters → Compliance reviews.

```ts
import { runRapidResponse } from "@corelay/mesh-campaign";

const result = await runRapidResponse(registry, {
  campaignId, opponentClaim: "PDP did nothing for roads", channel: "twitter", language: "en",
});
// result.approved === true → ready for one-tap publish
```

## Schemas

All Zod schemas are exported for validation and type inference:

```ts
import { CampaignSchema, CampaignMessageSchema, PollingUnitResultSchema } from "@corelay/mesh-campaign";
```

## Compliance

Static rules (banned terms, electoral violations) + LLM review:

```ts
import { runStaticChecks, reviewContent } from "@corelay/mesh-campaign";

const issues = runStaticChecks("We will destroy them", []);
// ["Hate speech / incitement detected: \"destroy them\""]
```

## War Room

Anomaly detection for election-day results:

```ts
import { detectAnomaly } from "@corelay/mesh-campaign";

const result = detectAnomaly({ APC: 500, PDP: 10 }, 400, 600);
// { isAnomaly: true, reason: "APC has 98.0% — possible ballot stuffing" }
```

## License

MIT — Corelay Ltd
