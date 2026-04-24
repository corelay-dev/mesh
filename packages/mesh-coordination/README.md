# @corelay/mesh-coordination

Multi-agent coordination patterns for the Corelay Mesh framework.

## Install

```bash
npm install @corelay/mesh-coordination
```

## Patterns

### Critic

Iterative critique loop — an LLM refines output over multiple cycles.

```ts
import { Critic, withCritic } from '@corelay/mesh-coordination';

const critic = Critic({ llm, model, domain, guardrails, maxCycles, tracer });
const peer = withCritic(basePeer, critic);
```

### Debate

Structured multi-participant debate scored by a judge.

```ts
import { runDebate } from '@corelay/mesh-coordination';

// judge.kind: 'rule' | 'human' | 'llm'
const result = await runDebate({ topic, participants, judge, rounds, tracer });
```

### Hierarchy

Task decomposition — a manager fans out to workers and merges results.

```ts
import { Hierarchy, LLMDecomposer, LLMMerger, managerPeer } from '@corelay/mesh-coordination';

const hierarchy = Hierarchy({
  task, workers,
  decomposer: LLMDecomposer({ llm, model }),
  merger: LLMMerger({ llm, model }),
  tracer,
});
const manager = managerPeer(hierarchy);
```

### HumanPeer

Human-in-the-loop peer with configurable escalation.

```ts
import { HumanPeer, EscalationPolicy } from '@corelay/mesh-coordination';

const human = HumanPeer({ address, inbox, registry, escalation: EscalationPolicy.OnFailure });
```

## Tracing

All patterns accept an optional `tracer` compatible with the `Tracer` interface from `@corelay/mesh-core`.

## License

MIT © [Corelay Ltd](https://github.com/corelay-dev/mesh)
