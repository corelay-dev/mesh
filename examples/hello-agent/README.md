# hello-agent

Minimal Corelay Mesh example. One agent, one tool-less turn, one real LLM call.

## Setup

```bash
# From the workspace root:
npm install

# Get an OpenAI key: https://platform.openai.com/api-keys
export OPENAI_API_KEY=sk-...

# Run it:
cd examples/hello-agent
npm start
```

## What it does

1. Creates a `PeerRegistry`.
2. Registers a single agent at address `demo/hello` backed by a real OpenAI client (`gpt-4o-mini`) and an in-memory inbox.
3. Calls `run(registry, "demo/hello", "What's the capital of Nigeria?")`.
4. Prints the reply.

That is it. No durability, no tools, no critic, no channels. The next example (`week-2/...`) adds Postgres durability.
