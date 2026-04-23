import type {
  Address,
  LLMClient,
  LLMRequest,
  Message,
  PeerRegistry,
} from "@corelay/mesh-core";

/**
 * A worker declaration — an address to delegate to, and a role description
 * the manager uses when deciding what to send it.
 */
export interface HierarchyWorker {
  address: Address;
  /** Human-readable role — e.g. "safety planner", "service finder". */
  role: string;
}

/**
 * Breaks a user task into one sub-task per relevant worker.
 *
 * Returned map is keyed by worker address; workers not included in the map
 * are skipped for that turn. Returning an empty map is legal — the caller
 * treats it as "no delegation needed."
 */
export interface TaskDecomposer {
  decompose(params: {
    userMessage: string;
    workers: HierarchyWorker[];
  }): Promise<Map<Address, string>>;
}

/**
 * Merges the workers' replies into one final answer the manager returns.
 */
export interface ResultMerger {
  merge(params: {
    userMessage: string;
    results: Array<{ worker: HierarchyWorker; reply: string }>;
  }): Promise<string>;
}

export interface HierarchyConfig {
  workers: HierarchyWorker[];
  registry: PeerRegistry;
  decomposer: TaskDecomposer;
  merger: ResultMerger;
  /**
   * Stable trace id used across all delegated messages. The caller usually
   * passes the incoming message's traceId here.
   */
  traceId: string;
  /**
   * Address the workers should reply *to*. The manager temporarily registers
   * a collector peer at this address to receive their answers.
   */
  collectorAddress: Address;
  /** Max ms to wait for all workers combined. Default 30_000. */
  timeoutMs?: number;
  /** Run workers in parallel (default) or sequentially. */
  mode?: "parallel" | "sequential";
}

export interface HierarchyResult {
  /** The merged final answer. */
  content: string;
  /** One entry per worker that actually produced a reply. */
  contributions: Array<{ worker: HierarchyWorker; reply: string }>;
  /** Workers that were invoked but timed out or errored. */
  missed: Array<{ worker: HierarchyWorker; reason: string }>;
}

/**
 * Manager-workers coordination.
 *
 *   1. Decompose the user message into per-worker sub-tasks.
 *   2. Dispatch each sub-task to its worker (Peer) via the registry.
 *   3. Collect replies up to timeoutMs.
 *   4. Merge replies into one final answer.
 *
 * This class is stateless — construct once, call `run()` per user task.
 * Workers are expected to reply by sending a Message addressed to
 * `collectorAddress`. A per-run collector is registered/unregistered around
 * the call.
 */
export class Hierarchy {
  constructor(private readonly config: HierarchyConfig) {}

  async run(params: { userMessage: string; from: Address }): Promise<HierarchyResult> {
    const { userMessage, from } = params;
    const {
      workers,
      registry,
      decomposer,
      merger,
      traceId,
      collectorAddress,
      timeoutMs = 30_000,
      mode = "parallel",
    } = this.config;

    const assignments = await decomposer.decompose({ userMessage, workers });
    const targets = workers.filter((w) => assignments.has(w.address));

    if (targets.length === 0) {
      const content = await merger.merge({ userMessage, results: [] });
      return { content, contributions: [], missed: [] };
    }

    const replies = new Map<Address, string>();
    let resolveAll: () => void;
    const allIn = new Promise<void>((res) => {
      resolveAll = res;
    });

    const collector = {
      address: collectorAddress,
      async send(message: Message) {
        replies.set(message.from, message.content);
        if (replies.size === targets.length) resolveAll();
      },
    };
    registry.register(collector);

    try {
      const dispatch = async (worker: HierarchyWorker): Promise<void> => {
        const subTask = assignments.get(worker.address);
        if (subTask === undefined) return;
        await registry.deliver({
          id: `${traceId}-${worker.address}`,
          // Reply target: Agents reply to message.from, so we set the
          // collector as the from-address. The original caller (passed
          // in `from`) is still visible to the worker via the trace metadata.
          from: collectorAddress,
          to: worker.address,
          kind: "peer",
          content: subTask,
          traceId,
          createdAt: Date.now(),
          metadata: { hierarchy: { collectorAddress, originalFrom: from } },
        });
      };

      if (mode === "parallel") {
        await Promise.all(targets.map(dispatch));
      } else {
        for (const w of targets) await dispatch(w);
      }

      await Promise.race([
        allIn,
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ]);
    } finally {
      registry.unregister(collectorAddress);
    }

    const contributions: Array<{ worker: HierarchyWorker; reply: string }> = [];
    const missed: Array<{ worker: HierarchyWorker; reason: string }> = [];
    for (const w of targets) {
      const reply = replies.get(w.address);
      if (reply !== undefined) {
        contributions.push({ worker: w, reply });
      } else {
        missed.push({ worker: w, reason: "timeout" });
      }
    }

    const content = await merger.merge({ userMessage, results: contributions });
    return { content, contributions, missed };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default LLM-backed decomposer and merger — provided as conveniences.
// Swap these for deterministic implementations in tests or if you want a
// non-LLM planner.
// ─────────────────────────────────────────────────────────────────────

export interface LLMDecomposerConfig {
  llm: LLMClient;
  model: string;
  /** Short sentence describing the manager's overall purpose. */
  domain: string;
  /** Max tokens for the decomposer call. Default 400. */
  maxTokens?: number;
}

/**
 * Default LLM-backed decomposer. Asks the model to emit a JSON object
 * { [workerAddress]: "sub-task" } for the workers it deems relevant.
 * Workers it does not mention are skipped.
 */
export class LLMDecomposer implements TaskDecomposer {
  constructor(private readonly config: LLMDecomposerConfig) {}

  async decompose(params: {
    userMessage: string;
    workers: HierarchyWorker[];
  }): Promise<Map<Address, string>> {
    const { userMessage, workers } = params;
    const request: LLMRequest = {
      model: this.config.model,
      maxTokens: this.config.maxTokens ?? 400,
      messages: [
        {
          role: "system",
          content: [
            `You are the manager of a ${this.config.domain}.`,
            "Decide which workers should handle the user's request and what to ask each one.",
            "",
            "Workers (address → role):",
            ...workers.map((w) => `  ${w.address} — ${w.role}`),
            "",
            'Respond with EXACTLY a JSON object mapping worker addresses to sub-task strings,',
            'e.g. {"tenant/worker-a": "do X", "tenant/worker-b": "do Y"}.',
            "Omit workers that do not need to act. Return {} if no worker is needed.",
          ].join("\n"),
        },
        { role: "user", content: userMessage },
      ],
    };
    const response = await this.config.llm.chat(request);
    return parseAssignments(response.content, workers);
  }
}

const parseAssignments = (
  raw: string,
  workers: HierarchyWorker[],
): Map<Address, string> => {
  const assignments = new Map<Address, string>();
  const allowed = new Set(workers.map((w) => w.address));
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return assignments;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    for (const [address, task] of Object.entries(parsed)) {
      if (allowed.has(address as Address) && typeof task === "string" && task.trim()) {
        assignments.set(address as Address, task);
      }
    }
  } catch {
    // Malformed JSON → no assignments. Caller merges zero contributions.
  }
  return assignments;
};

export interface LLMMergerConfig {
  llm: LLMClient;
  model: string;
  domain: string;
  maxTokens?: number;
}

/**
 * Default LLM-backed merger. Asks the model to combine the workers' replies
 * into one coherent answer to the original user message.
 */
export class LLMMerger implements ResultMerger {
  constructor(private readonly config: LLMMergerConfig) {}

  async merge(params: {
    userMessage: string;
    results: Array<{ worker: HierarchyWorker; reply: string }>;
  }): Promise<string> {
    const { userMessage, results } = params;
    if (results.length === 0) {
      return "I don't have enough information to answer yet.";
    }

    const request: LLMRequest = {
      model: this.config.model,
      maxTokens: this.config.maxTokens ?? 600,
      messages: [
        {
          role: "system",
          content: [
            `You are the manager of a ${this.config.domain}.`,
            "Combine the workers' replies into one coherent answer for the user.",
            "Attribute or merge naturally — do not label by worker name unless useful.",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            `User asked: "${userMessage}"`,
            "",
            "Worker replies:",
            ...results.map((r) => `- ${r.worker.role}: ${r.reply}`),
          ].join("\n"),
        },
      ],
    };

    const response = await this.config.llm.chat(request);
    return response.content;
  }
}
