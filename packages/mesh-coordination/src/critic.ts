import { noopTracer, type Tracer } from "@corelay/mesh-observe";
import type { LLMClient, LLMRequest } from "@corelay/mesh-core";

export interface CriticConfig {
  /**
   * The LLM the critic uses to review and revise. Pass an LLMRouter to benefit
   * from provider fallback; or a small cheap model for low-stakes agents.
   */
  llm: LLMClient;
  /** Model id for the critic's calls. Usually smaller/cheaper than the agent's. */
  model: string;
  /**
   * Domain description the critic uses when framing its review prompt.
   * Example: "safeguarding triage" or "revenue enquiry".
   */
  domain: string;
  /**
   * Extra rules the critic must check in addition to the defaults (factual
   * accuracy, safety, completeness, tone, harm).
   */
  guardrails?: string;
  /** Max revise → synthesise cycles before giving up. Default 2. */
  maxCycles?: number;
  /**
   * Responses shorter than this are auto-approved without a critic call.
   * Cheap defence against spending tokens on trivially-short replies.
   * Default 50.
   */
  autoApproveBelowChars?: number;
  /** Optional tracer. Defaults to noopTracer. */
  tracer?: Tracer;
}

export interface CriticVerdict {
  /** Final content to deliver. Equal to the input if approved first time. */
  content: string;
  /** How many critique → synthesis cycles were performed (0 = auto-approved). */
  cycles: number;
  /** True if the critic ever asked for a revision. */
  revised: boolean;
  /** Last critique, for tracing. */
  lastCritique?: string;
}

const APPROVED = "APPROVED";

const buildCritiquePrompt = (config: CriticConfig): string =>
  [
    `You are a quality critic for a ${config.domain} agent. Your job is to find problems in the agent's response.`,
    "",
    "Check for:",
    "1. Factual accuracy — does the response make claims it can't verify?",
    `2. Safety — does it violate any guardrails?${
      config.guardrails ? `\nGuardrails:\n${config.guardrails}` : ""
    }`,
    "3. Completeness — does it address the user's full question?",
    "4. Tone — is it appropriate for the domain?",
    "5. Harmful content — could this response cause harm?",
    "",
    `Respond with EXACTLY one of:`,
    `  ${APPROVED}             — if the response is good`,
    `  REVISE: <specific issue> — if it needs changes`,
  ].join("\n");

/**
 * Dialectical critic: thesis → antithesis → synthesis.
 *
 *  - **Thesis**       — the agent's draft reply (input to review()).
 *  - **Antithesis**   — a critic LLM call evaluates against domain-specific
 *                        checks + guardrails. Returns APPROVED or REVISE: ...
 *  - **Synthesis**    — if revised, a second LLM call rewrites the reply
 *                        addressing the issue.
 *
 * Up to `maxCycles` cycles. If still not approved after the last cycle, the
 * last revision is returned with `revised: true` so the caller can decide
 * whether to deliver or escalate.
 */
export class Critic {
  private readonly config: Required<Omit<CriticConfig, "tracer">>;
  private readonly tracer: Tracer;

  constructor(config: CriticConfig) {
    this.config = {
      maxCycles: 2,
      autoApproveBelowChars: 50,
      guardrails: "",
      ...config,
    };
    this.tracer = config.tracer ?? noopTracer;
  }

  async review(params: {
    userMessage: string;
    agentResponse: string;
    systemPrompt: string;
  }): Promise<CriticVerdict> {
    return this.tracer.span(
      "coordination.critic",
      {
        "critic.domain": this.config.domain,
        "critic.model": this.config.model,
        "critic.max_cycles": this.config.maxCycles,
        "response.length": params.agentResponse.length,
      },
      async (ctx) => {
        const verdict = await this.reviewInner(params);
        ctx.setAttributes({
          "critic.revised": verdict.revised,
          "critic.cycles": verdict.cycles,
        });
        return verdict;
      },
    );
  }

  private async reviewInner(params: {
    userMessage: string;
    agentResponse: string;
    systemPrompt: string;
  }): Promise<CriticVerdict> {
    const { userMessage, agentResponse, systemPrompt } = params;

    if (agentResponse.length < this.config.autoApproveBelowChars) {
      return { content: agentResponse, cycles: 0, revised: false };
    }

    let current = agentResponse;
    let lastCritique: string | undefined;

    for (let cycle = 1; cycle <= this.config.maxCycles; cycle++) {
      const critique = await this.critique(userMessage, current, cycle);
      lastCritique = critique;

      if (critique.trim().startsWith(APPROVED)) {
        return {
          content: current,
          cycles: cycle,
          revised: cycle > 1,
          lastCritique: critique,
        };
      }

      const issue = critique.replace(/^REVISE:\s*/i, "").trim();
      current = await this.revise(systemPrompt, userMessage, current, issue, cycle);
    }

    return { content: current, cycles: this.config.maxCycles, revised: true, lastCritique };
  }

  private async critique(userMessage: string, agentResponse: string, cycle: number): Promise<string> {
    return this.tracer.span(
      "coordination.critic.critique",
      { "critic.cycle": cycle },
      async () => {
        const request: LLMRequest = {
          model: this.config.model,
          maxTokens: 300,
          messages: [
            { role: "system", content: buildCritiquePrompt(this.config) },
            {
              role: "user",
              content: `User asked: "${userMessage}"\n\nAgent responded: "${agentResponse}"`,
            },
          ],
        };
        const response = await this.config.llm.chat(request);
        return response.content;
      },
    );
  }

  private async revise(
    systemPrompt: string,
    userMessage: string,
    agentResponse: string,
    issue: string,
    cycle: number,
  ): Promise<string> {
    return this.tracer.span(
      "coordination.critic.revise",
      { "critic.cycle": cycle },
      async () => {
        const request: LLMRequest = {
          model: this.config.model,
          maxTokens: 1024,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
            { role: "assistant", content: agentResponse },
            {
              role: "user",
              content: `A quality reviewer found this issue with your response: "${issue}". Provide a corrected response that addresses the concern. Return ONLY the corrected response text.`,
            },
          ],
        };
        const response = await this.config.llm.chat(request);
        return response.content;
      },
    );
  }
}
