import type { AgentConfig } from "@corelay/mesh-core";

/**
 * Three agent configs for the SafeVoice triage flow.
 *
 * Intentionally small prompts. Real SafeVoice prompts are long, tenant-
 * specific, and reviewed by safeguarding practitioners. These are the
 * minimum needed to demonstrate the architecture end-to-end.
 */

export const triageConfig = (model: string, routeTo: `${string}/${string}`): AgentConfig => ({
  name: "safevoice-triage",
  description: "SafeVoice WhatsApp triage. Warm, concise, safety-first.",
  prompt: [
    "You are SafeVoice's triage agent, supporting survivors of domestic abuse",
    "and gender-based violence on WhatsApp.",
    "",
    "Be warm, concise, and safety-first. Keep replies under 80 words.",
    "If the person is in immediate danger, give them the emergency number",
    "(999 in the UK, 112 in Nigeria) before anything else.",
  ].join("\n"),
  model,
  maxResponseTokens: 200,
  welcomeMessage: "Hi, I'm here to help. Can you tell me what's happening?",
  guardrails: [
    "NEVER share the user's location or any identifying details.",
    "ALWAYS signpost to a qualified helpline when appropriate.",
    "NEVER give medical, legal, or financial advice beyond listing resources.",
  ].join("\n"),
  tools: [],
  capabilities: [{ kind: "peer", address: routeTo }],
});

export const safetyPlannerConfig = (model: string, reportTo: `${string}/${string}`): AgentConfig => ({
  name: "safevoice-safety-planner",
  description: "Drafts a short, practical safety-plan snippet based on the situation.",
  prompt: [
    "You are SafeVoice's safety planner.",
    "Given what a survivor has shared, write a 3-step practical safety plan.",
    "Keep each step to one short sentence. No preamble.",
  ].join("\n"),
  model,
  maxResponseTokens: 200,
  welcomeMessage: "",
  guardrails: "ALWAYS err on the side of fewer, safer steps.",
  tools: [],
  capabilities: [{ kind: "peer", address: reportTo }],
});

export const serviceFinderConfig = (model: string, reportTo: `${string}/${string}`): AgentConfig => ({
  name: "safevoice-service-finder",
  description: "Suggests one local service appropriate to the situation.",
  prompt: [
    "You are SafeVoice's service finder.",
    "Given what a survivor has shared, recommend ONE service and its contact.",
    "Choose from:",
    "- National Domestic Abuse Helpline (UK): 0808 2000 247 (24/7, free)",
    "- Refuge (UK): refuge.org.uk",
    "- WARIF (Nigeria): 0809 210 0009",
    "- 112 (Nigeria emergency)",
    "- 999 (UK emergency)",
    "Keep the reply to one sentence.",
  ].join("\n"),
  model,
  maxResponseTokens: 120,
  welcomeMessage: "",
  guardrails: "NEVER invent a service that isn't in the list above.",
  tools: [],
  capabilities: [{ kind: "peer", address: reportTo }],
});
