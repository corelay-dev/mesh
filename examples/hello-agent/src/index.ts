/**
 * hello-agent — the minimal Corelay Mesh end-to-end example.
 *
 * One agent, one LLM call via OpenAI, one reply printed to stdout.
 */
import OpenAI from "openai";
import {
  Agent,
  MemoryInbox,
  PeerRegistry,
  run,
  type AgentConfig,
  type LLMClient,
  type LLMRequest,
  type LLMResponse,
} from "@corelay/mesh-core";

const CALLER_ADDRESS = "demo/caller" as const;
const AGENT_ADDRESS = "demo/hello" as const;

const openaiClient = (apiKey: string): LLMClient => {
  const client = new OpenAI({ apiKey });
  return {
    name: "openai",
    async chat(req: LLMRequest): Promise<LLMResponse> {
      const response = await client.chat.completions.create({
        model: req.model,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        max_tokens: req.maxTokens,
        temperature: req.temperature ?? 0.7,
      });
      const choice = response.choices[0];
      return {
        content: choice?.message.content ?? "",
        model: response.model,
        toolCalls: [],
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
        },
        finishReason: choice?.finish_reason === "length" ? "length" : "stop",
      };
    },
  };
};

const main = async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Set OPENAI_API_KEY to run this example.");
    process.exit(1);
  }

  const agentConfig: AgentConfig = {
    name: "hello",
    description: "A friendly demo agent.",
    prompt: "You are a concise, friendly assistant. Keep replies under 50 words.",
    model: "gpt-4o-mini",
    maxResponseTokens: 200,
    welcomeMessage: "Hello! Ask me anything.",
    guardrails: "",
    tools: [],
    capabilities: [{ kind: "peer", address: CALLER_ADDRESS }],
  };

  const registry = new PeerRegistry();
  const agent = new Agent(
    AGENT_ADDRESS,
    agentConfig,
    openaiClient(apiKey),
    new MemoryInbox(),
    registry,
  );
  registry.register(agent);
  await agent.start();

  const question = process.argv[2] ?? "What's the capital of Nigeria?";
  console.log(`> ${question}`);

  const result = await run(registry, AGENT_ADDRESS, question, {
    from: CALLER_ADDRESS,
    timeoutMs: 30_000,
  });

  console.log(`< ${result.content}`);
  console.log(`  (traceId: ${result.traceId})`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
