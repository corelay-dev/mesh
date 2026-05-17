import { z } from "zod";

export const SupporterTierSchema = z.enum(["coordinator", "agent", "volunteer", "supporter", "undecided"]);
export type SupporterTier = z.infer<typeof SupporterTierSchema>;

export const SupporterSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  name: z.string(),
  phone: z.string(),
  ward: z.string().nullable(),
  lga: z.string().nullable(),
  tier: SupporterTierSchema,
  assignedPollingUnit: z.string().nullable(),
  tags: z.array(z.string()).default([]),
  createdAt: z.coerce.date(),
});
export type Supporter = z.infer<typeof SupporterSchema>;
