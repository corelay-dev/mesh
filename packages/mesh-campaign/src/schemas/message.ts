import { z } from "zod";

export const ChannelSchema = z.enum(["whatsapp", "sms", "ussd", "twitter", "facebook", "instagram", "whatsapp_status"]);
export type Channel = z.infer<typeof ChannelSchema>;

export const LanguageSchema = z.enum(["en", "yo", "ha", "ig", "pcm"]);
export type Language = z.infer<typeof LanguageSchema>;

export const MessageStatusSchema = z.enum([
  "draft", "reviewed", "approved", "scheduled", "sent", "delivered", "failed",
]);
export type MessageStatus = z.infer<typeof MessageStatusSchema>;

export const AgentIdSchema = z.enum([
  "narrative", "intel", "strategy", "compliance", "mobilization", "research",
]);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const CampaignMessageSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  agentId: AgentIdSchema,
  channel: ChannelSchema,
  language: LanguageSchema,
  content: z.string(),
  targetSegment: z.string().nullable(),
  status: MessageStatusSchema,
  complianceNotes: z.string().nullable(),
  impactScore: z.number().nullable(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.coerce.date(),
});
export type CampaignMessage = z.infer<typeof CampaignMessageSchema>;
