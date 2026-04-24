import { describe, it, expect } from "vitest";
import { composeWorkflow, type WorkflowSpec } from "../src/index.js";
import type { ComposeAuthor } from "../src/index.js";

const safevoiceWorkflow: WorkflowSpec = {
  intent: "Survivor-first WhatsApp triage with specialist delegation and human handoff.",
  agents: [
    { role: "triage", intent: "First-contact triage, trauma-informed." },
    { role: "safety-planner", intent: "Help think through one immediate safety step." },
    { role: "service-finder", intent: "Find local NGOs and helplines." },
  ],
  coordination: [
    { from: "triage", to: "safety-planner", pattern: "delegates" },
    { from: "triage", to: "service-finder", pattern: "delegates" },
  ],
  guardrails: ["Never minimise.", "Never ask why they haven't left."],
  model: "gpt-4o-mini",
};

const fakeAuthor: ComposeAuthor = {
  draft: async () => JSON.stringify({
    agents: [
      { role: "triage", name: "sv-triage", description: "First contact.", prompt: "You are triage.", welcomeMessage: "Hi." },
      { role: "safety-planner", name: "sv-safety", description: "Safety steps.", prompt: "You help with safety.", welcomeMessage: "" },
      { role: "service-finder", name: "sv-services", description: "Find services.", prompt: "You find services.", welcomeMessage: "" },
    ],
    reviewerQuestions: ["Is the handoff to human caseworker covered?"],
  }),
};

describe("composeWorkflow()", () => {
  it("produces one AgentConfig per role", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    expect(Object.keys(draft.configs)).toEqual(["triage", "safety-planner", "service-finder"]);
  });

  it("wires capabilities from coordination edges", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    const triageCaps = draft.configs.triage!.capabilities;
    expect(triageCaps).toEqual([
      { kind: "peer", address: "workflow/safety-planner" },
      { kind: "peer", address: "workflow/service-finder" },
    ]);
    // Leaf agents have no outbound capabilities
    expect(draft.configs["safety-planner"]!.capabilities).toEqual([]);
    expect(draft.configs["service-finder"]!.capabilities).toEqual([]);
  });

  it("applies global guardrails to every agent", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    for (const config of Object.values(draft.configs)) {
      expect(config.guardrails).toContain("Never minimise");
      expect(config.guardrails).toContain("Never ask why");
    }
  });

  it("uses the specified model", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    for (const config of Object.values(draft.configs)) {
      expect(config.model).toBe("gpt-4o-mini");
    }
  });

  it("preserves coordination edges in the draft", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    expect(draft.coordination).toEqual(safevoiceWorkflow.coordination);
  });

  it("surfaces reviewer questions", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    expect(draft.reviewerQuestions).toContain("Is the handoff to human caseworker covered?");
  });

  it("preserves raw LLM output for audit", async () => {
    const draft = await composeWorkflow(safevoiceWorkflow, fakeAuthor);
    expect(draft.rawLlmOutput).toContain("sv-triage");
  });

  it("throws on empty agents list", async () => {
    await expect(
      composeWorkflow({ ...safevoiceWorkflow, agents: [] }, fakeAuthor),
    ).rejects.toThrow("at least one agent");
  });

  it("handles missing roles in LLM output gracefully", async () => {
    const partialAuthor: ComposeAuthor = {
      draft: async () => JSON.stringify({
        agents: [{ role: "triage", name: "t", description: "d", prompt: "p", welcomeMessage: "" }],
        reviewerQuestions: [],
      }),
    };
    const draft = await composeWorkflow(safevoiceWorkflow, partialAuthor);
    // Missing roles get fallback configs from the spec
    expect(draft.configs["safety-planner"]!.prompt).toContain("safety-planner");
    expect(draft.configs["service-finder"]!.prompt).toContain("service-finder");
  });
});
