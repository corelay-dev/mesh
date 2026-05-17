import { z } from "zod";

export const ElectionTypeSchema = z.enum([
  "gubernatorial", "senatorial", "house_of_reps", "state_assembly", "presidential", "lga",
]);
export type ElectionType = z.infer<typeof ElectionTypeSchema>;

export const CampaignSchema = z.object({
  id: z.string().uuid(),
  candidateName: z.string(),
  partyCode: z.string(),
  electionType: ElectionTypeSchema,
  state: z.string(),
  constituency: z.string().nullable(),
  electionDate: z.coerce.date().nullable(),
  isActive: z.boolean(),
  createdAt: z.coerce.date(),
});
export type Campaign = z.infer<typeof CampaignSchema>;
