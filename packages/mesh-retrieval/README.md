# @corelay/mesh-retrieval

Agentic RAG retrieval for Corelay Mesh — vector search, embeddings, critic-judged relevance, and grounding eval metrics.

## Features

- **Retriever interface** — `retrieve(query, opts) => Promise<Chunk[]>` primitive for any vector store
- **pgvector adapter** — cosine similarity search via postgres + pgvector extension
- **In-memory adapter** — brute-force cosine search for tests without a live DB
- **Embeddings via mesh-llm** — `LLMEmbedder` wraps any `LLMClient` as an embedding source
- **Agentic retrieval** — composes the Critic coordination pattern: retrieve → Critic judges relevance → rewrite query and re-retrieve if weak
- **Grounding eval** — faithfulness (claims grounded in context) and context-precision (retrieved chunks relevant to query) metrics, built on mesh-eval patterns

## Usage

```ts
import { MemoryRetriever, AgenticRetriever, GroundingEval } from "@corelay/mesh-retrieval";

// In-memory for tests
const retriever = new MemoryRetriever({ embedder, documents });

// Agentic retrieval with critic loop
const agentic = new AgenticRetriever({
  retriever,
  llm,
  model: "gpt-4o-mini",
  maxCycles: 2,
});

const chunks = await agentic.retrieve("What is the refund policy?");

// Evaluate grounding quality
const evaluator = new GroundingEval({ llm });
const faith = await evaluator.faithfulness({ answer, context: chunks });
const precision = await evaluator.contextPrecision({ query, context: chunks });
```

## Architecture

```
┌─────────────────────────────────────┐
│          AgenticRetriever           │
│  retrieve → Critic → rewrite loop  │
└──────────────┬──────────────────────┘
               │ delegates to
┌──────────────▼──────────────────────┐
│     Retriever (interface)           │
├─────────────────────────────────────┤
│  PgVectorRetriever │ MemoryRetriever│
└─────────────────────────────────────┘
```

## License

MIT
