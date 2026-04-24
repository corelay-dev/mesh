# @corelay/mesh-compose

> Corelay Compose — an authoring agent that drafts `AgentConfig`s from intent, for a human to review and approve.

## What this is

The core thesis of Corelay is **authoring-by-review**: in mission-led domains, the people who know the work (safeguarding practitioners, revenue officers, caseworkers) are not the people who write code, and they should not be asked to. Instead, they describe the agent they want, an authoring agent drafts the config, and the domain expert reviews, revises, and approves.

This package ships the v0.1 of that — intentionally minimal:

- `compose(spec, author)` — turn a `ComposeSpec` into a `ComposeDraft`.
- `approve(draft, overrides?)` — explicit approval returning an `AgentConfig`.
- `reject(draft, reason?)` — explicit rejection.
- Full provenance tracking — every `AgentConfig` field tagged as `user` / `llm` / `default`.

Compose **never auto-saves**. A caller must explicitly `approve()`.

## Install

```bash
npm install @corelay/mesh-compose
```

## Use

```ts
import { compose, approve } from "@corelay/mesh-compose";
import type { ComposeAuthor } from "@corelay/mesh-compose";

// Plug in any LLM; here a mock for illustration.
const author: ComposeAuthor = {
  draft: async (spec) => JSON.stringify({
    name: "safevoice-triage",
    description: "First-contact triage for survivors.",
    prompt: "You are a trauma-informed first responder...",
    welcomeMessage: "You're safe to talk here.",
    reviewerQuestions: ["No child-safeguarding boundary was specified. Is that intentional?"],
  }),
};

const draft = await compose(
  {
    intent: "First-contact triage for survivors of domestic abuse on WhatsApp.",
    domain: ["safeguarding", "UK", "trauma-informed"],
    guardrails: ["Never minimise.", "Never ask why they haven't left."],
    allowedPeers: ["safevoice/caseworker"],
  },
  author,
);

// A reviewer inspects draft.config and draft.reviewerQuestions, makes changes,
// and approves:
const config = approve(draft, { prompt: "...a better prompt from the practitioner..." });
// config is an AgentConfig you can now pass to Agent.
```

## What's not in v0.1

- **A real LLM author** — you plug in your own. A reference implementation using `@corelay/mesh-llm` arrives in v0.2.
- **Critic-wrapped authoring** — v0.2 will compose Compose with `@corelay/mesh-coordination`'s `withCritic` so the draft is automatically challenged before the reviewer sees it.
- **Eval generation** — v0.3, once `@corelay/mesh-eval` ships.
- **Workflow authoring** — v1.0. Currently Compose drafts a single agent; soon it will draft multi-agent flows.

## License

MIT © Corelay Ltd
