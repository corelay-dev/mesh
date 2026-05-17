import { z } from "zod";

export const ResultSourceSchema = z.enum(["agent_app", "whatsapp", "ussd", "sms", "manual"]);
export type ResultSource = z.infer<typeof ResultSourceSchema>;

export const PollingUnitResultSchema = z.object({
  id: z.string().uuid(),
  campaignId: z.string().uuid(),
  state: z.string(),
  lga: z.string(),
  ward: z.string(),
  pollingUnit: z.string(),
  pollingUnitCode: z.string(),
  results: z.record(z.string(), z.number()),
  accreditedVoters: z.number().int().nullable(),
  registeredVoters: z.number().int().nullable(),
  source: ResultSourceSchema,
  reportedBy: z.string(),
  photoUrl: z.string().nullable(),
  isAnomaly: z.boolean().default(false),
  anomalyReason: z.string().nullable(),
  reportedAt: z.coerce.date(),
});
export type PollingUnitResult = z.infer<typeof PollingUnitResultSchema>;

export const WardSchema = z.object({
  state: z.string(),
  lga: z.string(),
  ward: z.string(),
  pollingUnitCount: z.number().int(),
  registeredVoters: z.number().int().nullable(),
  historicalResults: z.record(z.string(), z.number()).nullable(),
});
export type Ward = z.infer<typeof WardSchema>;
