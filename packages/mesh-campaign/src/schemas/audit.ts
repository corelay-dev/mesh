import { z } from "zod";
import { AgentIdSchema } from "./message.js";

export const AuditActionSchema = z.enum([
  "agent.run", "agent.compliance_review",
  "approval.approve", "approval.edit", "approval.reject",
  "message.send", "message.deliver", "message.fail",
  "warroom.result_received", "warroom.anomaly_detected",
  "campaign.create", "campaign.update",
  "scheduler.job_complete", "scheduler.job_fail",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const CostEntrySchema = z.object({
  campaignId: z.string().uuid(),
  agentId: AgentIdSchema,
  model: z.string(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
});
export type CostEntry = z.infer<typeof CostEntrySchema>;

export const ApprovalActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("edit"), edited: z.string().min(1) }),
  z.object({ action: z.literal("reject"), reason: z.string().min(1) }),
]);
export type ApprovalAction = z.infer<typeof ApprovalActionSchema>;
