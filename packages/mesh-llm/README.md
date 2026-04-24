# @corelay/mesh-llm

LLM router and provider clients for [Corelay Mesh](https://github.com/corelay-dev/mesh). Route completions through a primary provider with automatic fallback to alternatives.

## Providers

| Client | Wraps |
| --- | --- |
| `OpenAIClient` | `openai` |
| `AnthropicClient` | `@anthropic-ai/sdk` |
| `BedrockClient` | `@aws-sdk/client-bedrock-runtime` |

Every client implements the `LLMClient` interface from `@corelay/mesh-core`.

## Install

```bash
npm install @corelay/mesh-llm
# Peer-install only the SDKs you need:
npm install openai                           # OpenAI
npm install @anthropic-ai/sdk                # Anthropic
npm install @aws-sdk/client-bedrock-runtime  # Bedrock
```

## Usage

```ts
import { LLMRouter, OpenAIClient, AnthropicClient } from "@corelay/mesh-llm";

const router = new LLMRouter({
  primary: "openai",
  fallbacks: ["anthropic"],
  providers: [
    new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY }),
    new AnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY }),
  ],
});

const response = await router.complete({ model: "gpt-4o", messages });
```

If the primary fails, `LLMRouter` walks `fallbacks` in order until one succeeds.

## API — `LLMRouter(options)`

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `primary` | `string` | yes | Primary provider name |
| `fallbacks` | `string[]` | no | Ordered fallback provider names |
| `providers` | `LLMClient[]` | yes | Provider instances |

## License

[MIT](./LICENSE) © Corelay Ltd