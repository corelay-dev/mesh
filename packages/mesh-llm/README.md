# @corelay/mesh-llm

LLM router and provider clients for Corelay Mesh.

Ships an `LLMRouter` that implements `@corelay/mesh-core`'s `LLMClient`
interface by composing one primary provider and an ordered fallback list.
Provider implementations for OpenAI, Anthropic, and AWS Bedrock are
included.

**Status: Week 2 — in development.**

## Peer dependencies

Providers are installed as peer dependencies. Install only what you use:

```bash
# OpenAI
npm install openai

# Anthropic
npm install @anthropic-ai/sdk

# Bedrock (Claude)
npm install @aws-sdk/client-bedrock-runtime
```
