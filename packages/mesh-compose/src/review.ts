import type { AgentConfig } from "@corelay/mesh-core";
import type { ComposeDraft } from "./types.js";

/**
 * Explicit approval step. A reviewer looks at a ComposeDraft and either
 * approves it — returning an AgentConfig suitable for saving — or rejects
 * it, returning nothing.
 *
 * This function exists to make the review-gated semantics visible in the
 * API. There is no "auto-approve"; the caller must explicitly invoke this.
 *
 * @param draft - the Compose output under review
 * @param overrides - any fields the reviewer wants to change. Typically this
 *   is where domain experts correct the LLM's first draft.
 * @returns the approved AgentConfig. Ready to save.
 */
export const approve = (
  draft: ComposeDraft,
  overrides: Partial<AgentConfig> = {},
): AgentConfig => ({
  ...draft.config,
  ...overrides,
});

/**
 * Explicit rejection. Returns nothing; callers can use this to signal the
 * review was done and the draft was discarded, for audit purposes.
 *
 * Compose does not persist anything on reject; this is a semantic hook.
 */
export const reject = (_draft: ComposeDraft, _reason?: string): void => {
  // Intentionally empty. Present so rejection is a first-class API call,
  // not an absence. Hooks (logging, audit) can be wired here in v0.2+.
};
