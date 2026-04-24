import type { AgentConfig } from "@corelay/mesh-core";

/**
 * A specification of the agent the human wants. This is the input to
 * Compose — typically written by a domain expert, not an engineer.
 *
 * All fields are optional except `intent`. Compose uses whatever is provided
 * and leaves gaps in the draft (as `??`) that the reviewer can fill in.
 */
export interface ComposeSpec {
  /**
   * The one-sentence description of what the agent should do. Required.
   * e.g. "First-contact triage for survivors of domestic abuse on WhatsApp."
   */
  intent: string;

  /** Domain keywords to anchor the prompt — e.g. ["safeguarding", "UK", "Women's Aid"]. */
  domain?: string[];

  /**
   * 1–5 worked examples. Each is a user message and the kind of reply the
   * expert would want back. Compose uses these to infer tone and depth.
   */
  examples?: ReadonlyArray<{ input: string; desiredReply: string }>;

  /**
   * Plain-English guardrail rules. These get copied verbatim into the
   * draft's `guardrails` field; Compose does not invent additional ones.
   */
  guardrails?: ReadonlyArray<string>;

  /**
   * Who the agent can talk to. Compose maps these to PeerCapability entries
   * in the draft; the runtime enforces them.
   */
  allowedPeers?: ReadonlyArray<string>;

  /** Preferred model. Default "gpt-4o-mini". */
  model?: string;
}

/**
 * Compose's output. A drafted AgentConfig plus the full provenance chain
 * so the reviewer can trace every field back to its source.
 *
 * Drafts are NEVER auto-saved. A caller must explicitly approve or reject.
 */
export interface ComposeDraft {
  /** The drafted AgentConfig. Ready to be approved by the reviewer. */
  config: AgentConfig;

  /**
   * Per-field provenance: for each AgentConfig field, where did the value
   * come from — `user` (directly from spec), `llm` (drafted by Compose), or
   * `default` (Mesh default applied because neither supplied it).
   */
  provenance: Readonly<Record<keyof AgentConfig, "user" | "llm" | "default">>;

  /**
   * The raw draft the LLM returned. Kept for audit; reviewers can compare
   * their approved config against it to see exactly what they changed.
   */
  rawLlmOutput: string;

  /**
   * Questions Compose thinks the reviewer should think about before
   * approving. e.g. "You didn't specify a child-safeguarding boundary; is
   * that intentional?" Never a blocker — just a nudge.
   */
  reviewerQuestions: ReadonlyArray<string>;
}

/**
 * The LLM contract Compose uses. Intentionally minimal so callers can
 * back it with any provider (mesh-llm, raw OpenAI, a mock, etc.).
 */
export interface ComposeAuthor {
  /**
   * Given a spec, return a JSON string describing the draft fields Compose
   * should fill in. The shape Compose expects is documented in
   * `src/author.ts`.
   */
  draft(spec: ComposeSpec): Promise<string>;
}
