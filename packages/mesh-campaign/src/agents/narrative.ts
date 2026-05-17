import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";
import type { PromptContextStore } from "../memory/prompt-builder.js";
import { buildNarrativePrompt, buildCounterNarrativePrompt } from "../memory/prompt-builder.js";
import type { Channel, Language } from "../schemas/message.js";

export const NarrativeRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("generate"),
    campaignId: z.string().uuid(),
    task: z.string(),
    channel: ChannelSchema,
    language: LanguageSchema,
  }),
  z.object({
    kind: z.literal("batch"),
    campaignId: z.string().uuid(),
    task: z.string(),
    channel: ChannelSchema,
    language: LanguageSchema,
    count: z.number().int().min(1).max(10).default(3),
  }),
  z.object({
    kind: z.literal("counter"),
    campaignId: z.string().uuid(),
    opponentClaim: z.string(),
    channel: ChannelSchema,
    language: LanguageSchema,
  }),
]);

// Re-import for use in schema
import { ChannelSchema, LanguageSchema } from "../schemas/message.js";

export type NarrativeRequest = z.infer<typeof NarrativeRequestSchema>;

export interface NarrativeOutput {
  content: string;
  tone: string;
  targetAudience: string;
}

const BatchResultSchema = z.object({
  messages: z.array(z.object({
    content: z.string(),
    tone: z.string(),
    targetAudience: z.string(),
  })),
});

export interface NarrativeAgentDeps {
  llm: LLMClient;
  contextStore: PromptContextStore;
}

export async function handleNarrativeRequest(
  request: NarrativeRequest,
  deps: NarrativeAgentDeps,
): Promise<NarrativeOutput[]> {
  const { llm, contextStore } = deps;

  switch (request.kind) {
    case "generate": {
      const ctx = await contextStore.loadContext(request.campaignId, "narrative");
      const systemPrompt = buildNarrativePrompt(ctx, request.task, request.channel, request.language);
      const response = await llm.chat({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: request.task },
        ],
        maxTokens: 1000,
        temperature: 0.7,
      });
      return [{ content: response.content, tone: "campaign", targetAudience: "general" }];
    }

    case "batch": {
      const ctx = await contextStore.loadContext(request.campaignId, "narrative");
      const systemPrompt = buildNarrativePrompt(ctx, request.task, request.channel, request.language);
      const response = await llm.chat({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `${request.task}\n\nGenerate ${request.count} variations. Respond with JSON: {"messages": [{"content": "...", "tone": "...", "targetAudience": "..."}]}`,
          },
        ],
        maxTokens: 3000,
        temperature: 0.8,
      });

      try {
        const parsed = BatchResultSchema.parse(JSON.parse(response.content));
        return parsed.messages;
      } catch {
        return [{ content: response.content, tone: "campaign", targetAudience: "general" }];
      }
    }

    case "counter": {
      const ctx = await contextStore.loadContext(request.campaignId, "narrative");
      const systemPrompt = buildCounterNarrativePrompt(ctx);
      const response = await llm.chat({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Opponent claim to counter: "${request.opponentClaim}"` },
        ],
        maxTokens: 500,
        temperature: 0.5,
      });
      return [{ content: response.content, tone: "counter-narrative", targetAudience: "general" }];
    }
  }
}
