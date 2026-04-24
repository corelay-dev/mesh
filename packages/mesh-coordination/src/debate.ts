import { noopTracer, type Tracer } from "@corelay/mesh-observe";
import type { LLMClient, LLMRequest } from "@corelay/mesh-core";

/**
 * A Debate participant. Each participant is an LLM-backed voice with its own
 * stance, system prompt, and model. Keep participants small and focused —
 * two to four is the sweet spot.
 */
export interface DebateParticipant {
  /** Stable name used in the exchange and verdict. */
  name: string;
  /** System prompt shaping this participant's stance and style. */
  stance: string;
  /** LLM backing this participant. Each participant can use a different one. */
  llm: LLMClient;
  /** Model id for this participant. */
  model: string;
}

/**
 * A turn in the exchange — who spoke, what they said, in which round.
 */
export interface DebateTurn {
  round: number;
  participant: string;
  content: string;
}

/**
 * The judge decides the verdict. Three shapes cover the common cases:
 * - llm: a judge LLM with its own stance
 * - rule: a synchronous function — useful for tests and deterministic cases
 * - human: a deferred promise the caller resolves after review
 */
export type DebateJudge =
  | { kind: "llm"; llm: LLMClient; model: string; stance: string }
  | {
      kind: "rule";
      decide: (
        topic: string,
        exchange: ReadonlyArray<DebateTurn>,
      ) => { verdict: string; rationale: string };
    }
  | {
      kind: "human";
      submit: (
        topic: string,
        exchange: ReadonlyArray<DebateTurn>,
      ) => Promise<{ verdict: string; rationale: string }>;
    };

export interface DebateConfig {
  /** The question or claim under debate. */
  topic: string;
  /** Two or more participants. */
  participants: ReadonlyArray<DebateParticipant>;
  /** Who decides the verdict. */
  judge: DebateJudge;
  /** Number of rounds. Each round, every participant speaks once. Default 2. */
  rounds?: number;
  /** Optional tracer. Defaults to noopTracer. */
  tracer?: Tracer;
}

export interface DebateResult {
  topic: string;
  exchange: ReadonlyArray<DebateTurn>;
  verdict: string;
  rationale: string;
  rounds: number;
  judgeKind: DebateJudge["kind"];
}

const DEFAULT_ROUNDS = 2;

/**
 * Run a debate. Participants speak in order, once per round. After all rounds
 * the judge decides. The full exchange is returned so callers can audit or
 * replay the argument, not just the verdict.
 */
export const runDebate = async (config: DebateConfig): Promise<DebateResult> => {
  if (config.participants.length < 2) {
    throw new Error("Debate needs at least two participants");
  }

  const tracer = config.tracer ?? noopTracer;
  const rounds = config.rounds ?? DEFAULT_ROUNDS;

  return tracer.span(
    "coordination.debate",
    {
      "debate.participants": config.participants.length,
      "debate.rounds": rounds,
      "debate.judge_kind": config.judge.kind,
    },
    async (ctx) => {
      const exchange: DebateTurn[] = [];

      for (let round = 1; round <= rounds; round++) {
        for (const p of config.participants) {
          const content = await speak(p, config.topic, exchange, round);
          exchange.push({ round, participant: p.name, content });
        }
      }

      const { verdict, rationale } = await decide(config.judge, config.topic, exchange);

      ctx.setAttributes({ "debate.verdict_length": verdict.length });

      return {
        topic: config.topic,
        exchange,
        verdict,
        rationale,
        rounds,
        judgeKind: config.judge.kind,
      };
    },
  );
};

const speak = async (
  p: DebateParticipant,
  topic: string,
  exchange: ReadonlyArray<DebateTurn>,
  round: number,
): Promise<string> => {
  const request: LLMRequest = {
    model: p.model,
    temperature: 0.4,
    maxTokens: 400,
    messages: [
      { role: "system", content: p.stance },
      {
        role: "user",
        content: [
          `Topic: ${topic}`,
          exchange.length > 0 ? "Exchange so far:" : "You are the first to speak.",
          ...exchange.map((t) => `[${t.participant}, round ${t.round}] ${t.content}`),
          "",
          `This is round ${round}. Respond in one concise paragraph.`,
        ].join("\n"),
      },
    ],
  };

  const response = await p.llm.chat(request);
  return response.content.trim();
};

const decide = async (
  judge: DebateJudge,
  topic: string,
  exchange: ReadonlyArray<DebateTurn>,
): Promise<{ verdict: string; rationale: string }> => {
  switch (judge.kind) {
    case "rule":
      return judge.decide(topic, exchange);
    case "human":
      return judge.submit(topic, exchange);
    case "llm":
      return decideWithLlm(judge, topic, exchange);
  }
};

const decideWithLlm = async (
  judge: { llm: LLMClient; model: string; stance: string },
  topic: string,
  exchange: ReadonlyArray<DebateTurn>,
): Promise<{ verdict: string; rationale: string }> => {
  const response = await judge.llm.chat({
    model: judge.model,
    temperature: 0,
    maxTokens: 300,
    messages: [
      { role: "system", content: judge.stance },
      {
        role: "user",
        content: [
          `Topic: ${topic}`,
          "Full exchange:",
          ...exchange.map((t) => `[${t.participant}, round ${t.round}] ${t.content}`),
          "",
          "Return a JSON object with exactly two keys:",
          '- verdict: string. Your decision.',
          "- rationale: string. One short sentence.",
          "Return JSON only — no prose, no fences.",
        ].join("\n"),
      },
    ],
  });

  return parseVerdict(response.content);
};

const parseVerdict = (raw: string): { verdict: string; rationale: string } => {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")
    : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { verdict: "", rationale: `Judge returned invalid JSON: ${cause}` };
  }
  if (!parsed || typeof parsed !== "object") {
    return { verdict: "", rationale: "Judge returned a non-object" };
  }
  const obj = parsed as Record<string, unknown>;
  return {
    verdict: typeof obj.verdict === "string" ? obj.verdict : "",
    rationale:
      typeof obj.rationale === "string"
        ? obj.rationale
        : "Judge did not supply a rationale.",
  };
};
