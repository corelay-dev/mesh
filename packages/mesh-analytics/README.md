# @corelay/mesh-analytics

Analytics, reflection, and experimentation for Corelay Mesh campaigns. Tracks engagement, learns from human edits, runs A/B tests, and generates performance reports.

## Install

```bash
npm install @corelay/mesh-analytics
```

## Quick Start — Reflection Flow

```typescript
import {
  captureEdit,
  extractRule,
  updatePromptRules,
  InMemoryRuleStore,
} from "@corelay/mesh-analytics";
import type { LLMClient } from "@corelay/mesh-core";

// 1. Capture an edit made by a human operator
const edit = captureEdit(
  "Vote for candidate X for a better tomorrow",
  "Your roads, your schools — candidate X delivers",
  { messageId: "msg-42", campaignId: "camp-1", editedBy: "strategist-1" },
);

// 2. Extract a generalizable rule from the edit
const rule = await extractRule(edit, llmClient);
// => { rule: "Focus on concrete deliverables rather than abstract promises", ... }

// 3. Merge into campaign rules (deduplicates similar rules)
const ruleStore = new InMemoryRuleStore();
await updatePromptRules("camp-1", rule, ruleStore);
```

## API Reference

### Tracker

| Export | Description |
|--------|-------------|
| `InMemoryEngagementStore` | Tracks likes, replies, shares, impressions per message |
| `InMemoryDeliveryStore` | Tracks sent/delivered/read/failed per channel |
| `InMemoryAttributionStore` | Links supporter actions to messages |
| `attributeAction(event, store)` | Records which message drove a supporter action |

### Reflection

| Export | Description |
|--------|-------------|
| `captureEdit(original, edited, metadata)` | Creates an EditCapture record |
| `diffContent(original, edited)` | Human-readable diff summary |
| `extractRule(edit, llm)` | LLM-powered rule extraction from edits |
| `updatePromptRules(campaignId, rule, store)` | Merges rules with deduplication |
| `InMemoryRuleStore` | In-memory rule storage |

### Experiments

| Export | Description |
|--------|-------------|
| `createABTest(config)` | Sets up an A/B test |
| `concludeTest(test, engagementData)` | Picks winner by engagement |
| `createSegments(supporters, count)` | Random N-way split |
| `createSegmentByWard(supporters, ward)` | Geographic segmentation |
| `isSignificant(control, test, n, confidence?)` | Z-test for proportions |

### Feedback

| Export | Description |
|--------|-------------|
| `generateFeedbackContext(campaignId, engagementStore, ruleStore)` | Aggregates context for prompt injection |
| `extractLearnings(engagementData, campaignId)` | Identifies performance patterns |
| `applyDecay(rules, now?)` | Reduces confidence of stale rules |
| `archiveStaleRules(rules, threshold?)` | Identifies rules for archival |

### Reports

| Export | Description |
|--------|-------------|
| `generateWeeklyReport(campaignId, engagementStore, deliveryStore, llm)` | LLM narrative summary |
| `compareChannels(campaignId, engagementStore, deliveryStore)` | Channel performance comparison |
| `analyzeWardResponse(campaignId, attributionStore, engagementStore)` | Ward-level response analysis |
