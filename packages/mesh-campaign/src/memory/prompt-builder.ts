import type { Channel, Language } from "../schemas/message.js";
import type { BrandVoice } from "./brand-voice.js";
import { formatBrandVoiceForPrompt } from "./brand-voice.js";

export interface CampaignPromptContext {
  candidateProfile: string[];
  keyPolicies: string[];
  donts: string[];
  brandVoice: BrandVoice | null;
  learnedRules: string[];
  historicalPerformance: string[];
}

export interface PromptContextStore {
  loadContext(campaignId: string, agentId: string): Promise<CampaignPromptContext>;
}

export function buildNarrativePrompt(
  ctx: CampaignPromptContext,
  task: string,
  channel: Channel,
  language: Language,
): string {
  const sections: string[] = [
    "You are a campaign communications specialist for a Nigerian political campaign.",
  ];

  if (ctx.candidateProfile.length > 0) {
    sections.push(`## Candidate\n${ctx.candidateProfile.join("\n")}`);
  }
  if (ctx.keyPolicies.length > 0) {
    sections.push(`## Key Policies\n${ctx.keyPolicies.join("\n")}`);
  }
  if (ctx.brandVoice) {
    sections.push(formatBrandVoiceForPrompt(ctx.brandVoice));
  }
  if (ctx.learnedRules.length > 0) {
    sections.push(`## Learned Preferences (from past edits)\n${ctx.learnedRules.map((r) => `- ${r}`).join("\n")}`);
  }
  if (ctx.donts.length > 0) {
    sections.push(`## Never Do\n${ctx.donts.map((d) => `- ${d}`).join("\n")}`);
  }
  if (ctx.historicalPerformance.length > 0) {
    sections.push(`## What Works (from analytics)\n${ctx.historicalPerformance.map((p) => `- ${p}`).join("\n")}`);
  }

  sections.push(`## Channel: ${channel}`);
  sections.push(`## Language: ${language}`);
  sections.push("## Rules");
  sections.push("- Never use hate speech, tribal attacks, or religious incitement");
  sections.push("- Stay factual — do not fabricate claims about opponents");
  sections.push("- Keep it dignified — voters respect composure");
  sections.push("- Output ONLY the message content, no meta-commentary");

  return sections.join("\n\n");
}

export function buildCounterNarrativePrompt(ctx: CampaignPromptContext): string {
  const sections: string[] = [
    "You are a campaign rapid response specialist for a Nigerian political campaign.",
  ];

  if (ctx.candidateProfile.length > 0) {
    sections.push(`## Candidate\n${ctx.candidateProfile.join("\n")}`);
  }
  if (ctx.keyPolicies.length > 0) {
    sections.push(`## Our Policies\n${ctx.keyPolicies.join("\n")}`);
  }
  if (ctx.brandVoice) {
    sections.push(formatBrandVoiceForPrompt(ctx.brandVoice));
  }

  sections.push("## Rules");
  sections.push("- Counter with FACTS, not insults");
  sections.push("- Never use hate speech or tribal/religious attacks");
  sections.push("- Redirect to our candidate's strengths and track record");
  sections.push("- Keep it dignified — voters respect composure");
  sections.push("- Output ONLY the response message");

  return sections.join("\n\n");
}
