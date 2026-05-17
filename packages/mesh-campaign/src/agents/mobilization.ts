import { z } from "zod";
import type { LLMClient } from "@corelay/mesh-core";
import { LanguageSchema, ChannelSchema } from "../schemas/message.js";
import type { SupporterTier } from "../schemas/supporter.js";

export const MobilizationRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ward_blast"),
    campaignId: z.string().uuid(),
    ward: z.string(),
    lga: z.string(),
    message: z.string(),
    channel: ChannelSchema,
    language: LanguageSchema,
    tiers: z.array(z.enum(["coordinator", "agent", "volunteer", "supporter", "undecided"])).default(["coordinator", "agent", "volunteer"]),
  }),
  z.object({
    kind: z.literal("rally_invite"),
    campaignId: z.string().uuid(),
    rallyDetails: z.object({
      venue: z.string(),
      date: z.string(),
      time: z.string(),
      lga: z.string(),
    }),
    channel: ChannelSchema,
    language: LanguageSchema,
    radius: z.enum(["ward", "lga", "state"]).default("lga"),
  }),
]);
export type MobilizationRequest = z.infer<typeof MobilizationRequestSchema>;

export interface MobilizationOutput {
  recipientCount: number;
  message: string;
  channel: string;
  targetDescription: string;
}

export interface MobilizationAgentDeps {
  llm: LLMClient;
  getSupporters(campaignId: string, filters: { ward?: string; lga?: string; tiers?: SupporterTier[] }): Promise<Array<{ id: string; name: string; phone: string; tier: SupporterTier }>>;
}

export async function handleMobilizationRequest(
  request: MobilizationRequest,
  deps: MobilizationAgentDeps,
): Promise<MobilizationOutput> {
  switch (request.kind) {
    case "ward_blast": {
      const supporters = await deps.getSupporters(request.campaignId, {
        ward: request.ward,
        tiers: request.tiers as SupporterTier[],
      });

      return {
        recipientCount: supporters.length,
        message: request.message,
        channel: request.channel,
        targetDescription: `${request.ward} ward, ${request.lga} LGA — ${request.tiers.join(", ")} tiers`,
      };
    }

    case "rally_invite": {
      const { rallyDetails, radius } = request;
      const filters: { lga?: string } = {};
      if (radius === "lga" || radius === "ward") filters.lga = rallyDetails.lga;

      const supporters = await deps.getSupporters(request.campaignId, filters);

      const response = await deps.llm.chat({
        model: "claude-sonnet-4-20250514",
        messages: [
          {
            role: "system",
            content: `You are a campaign mobilization coordinator. Generate a short, energetic rally invitation message in ${request.language}. Include venue, date, time. Keep it under 300 characters for WhatsApp/SMS.`,
          },
          {
            role: "user",
            content: `Rally at ${rallyDetails.venue}, ${rallyDetails.date} at ${rallyDetails.time} in ${rallyDetails.lga}. Generate the invitation.`,
          },
        ],
        maxTokens: 200,
        temperature: 0.7,
      });

      return {
        recipientCount: supporters.length,
        message: response.content,
        channel: request.channel,
        targetDescription: `${radius}-level supporters in ${rallyDetails.lga} — rally at ${rallyDetails.venue}`,
      };
    }
  }
}
