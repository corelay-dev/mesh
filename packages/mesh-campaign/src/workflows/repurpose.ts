import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";
import type { Channel, Language } from "../schemas/message.js";

export const RepurposeInputSchema = z.object({
  campaignId: z.string().uuid(),
  sourceContent: z.string().min(50),
  sourceType: z.enum(["speech", "article", "press_release", "interview", "policy_document"]),
  targetPlatforms: z.array(z.enum(["twitter", "facebook", "instagram", "whatsapp", "whatsapp_status"])),
  language: z.enum(["en", "yo", "ha", "ig", "pcm"]).default("en"),
  postCount: z.number().int().min(1).max(10).default(5),
});
export type RepurposeInput = z.infer<typeof RepurposeInputSchema>;

export interface RepurposedPost {
  index: number;
  platform: Channel;
  content: string;
  hook: string;
  suggestedMedia: string;
}

export interface RepurposeResult {
  campaignPlan: string;
  posts: RepurposedPost[];
}

const CampaignPlanSchema = z.object({
  posts: z.array(z.object({
    index: z.number(),
    platform: z.string(),
    content: z.string(),
    hook: z.string(),
    suggestedMedia: z.string(),
  })),
});

/**
 * Repurpose workflow:
 * 1. Extract key points from source content
 * 2. Generate a multi-post campaign plan
 * 3. Produce platform-specific posts
 */
export async function runRepurposeWorkflow(
  input: RepurposeInput,
  llm: LLMClient,
): Promise<RepurposeResult> {
  const { sourceContent, sourceType, targetPlatforms, language, postCount } = input;

  // Step 1+2: Generate campaign plan with posts in one LLM call
  const response = await llm.chat({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "system",
        content: `You are a Nigerian political campaign content strategist. You take a ${sourceType} and repurpose it into ${postCount} social media posts across platforms.

Rules:
- Each post must stand alone (readers won't see the others)
- Vary the angle — don't repeat the same point
- Respect platform constraints: Twitter (280 chars), WhatsApp Status (700 chars), Instagram (2200 chars), Facebook (no limit but keep punchy)
- Language: ${language === "pcm" ? "Nigerian Pidgin" : language === "yo" ? "Yoruba" : language === "ha" ? "Hausa" : language === "ig" ? "Igbo" : "English"}
- Include a hook (first line that grabs attention)
- Suggest media type for each (photo, infographic, video clip, quote card)
- Never fabricate facts not in the source

Respond with JSON:
{
  "posts": [
    {"index": 1, "platform": "twitter", "content": "...", "hook": "...", "suggestedMedia": "quote card"}
  ]
}`,
      },
      {
        role: "user",
        content: `Source (${sourceType}):\n\n${sourceContent}\n\nTarget platforms: ${targetPlatforms.join(", ")}\nGenerate ${postCount} posts distributed across these platforms.`,
      },
    ],
    maxTokens: 4000,
    temperature: 0.7,
  });

  try {
    const parsed = CampaignPlanSchema.parse(JSON.parse(response.content));
    return {
      campaignPlan: response.content,
      posts: parsed.posts.map((p) => ({
        index: p.index,
        platform: p.platform as Channel,
        content: p.content,
        hook: p.hook,
        suggestedMedia: p.suggestedMedia,
      })),
    };
  } catch {
    return {
      campaignPlan: response.content,
      posts: [],
    };
  }
}
