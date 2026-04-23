import {
  HumanPeer,
  type HumanAction,
} from "@corelay/mesh-coordination";
import {
  MemoryInbox,
  type Address,
  type PeerRegistry,
} from "@corelay/mesh-core";
import type { Tracer } from "@corelay/mesh-observe";

export const CASEWORKER: Address = "safevoice/caseworker/alice";

export interface HighRiskOptions {
  registry: PeerRegistry;
  tracer?: Tracer;
  /** Escalation timeout — if no human responds by then, auto-reject. */
  timeoutMs?: number;
}

/**
 * Register a HumanPeer at safevoice/caseworker/alice.
 *
 * Returns the peer instance so the driver can call respond() on it — the
 * simulated "caseworker" action. In production the respond() call would
 * come from an API endpoint the caseworker's UI posts to.
 */
export const registerCaseworker = async (options: HighRiskOptions): Promise<HumanPeer> => {
  const human = new HumanPeer({
    address: CASEWORKER,
    inbox: new MemoryInbox(),
    registry: options.registry,
    escalation: {
      timeoutMs: options.timeoutMs ?? 5 * 60 * 1000,
      onTimeout: "reject",
      reason:
        "We couldn't reach a caseworker in time. If you're in immediate danger, please call 999 (UK) or 112 (Nigeria).",
    },
    ...(options.tracer !== undefined && { tracer: options.tracer }),
  });
  options.registry.register(human);
  await human.start();
  return human;
};

/**
 * Simulate a caseworker acting on one pending item. In production this
 * is an HTTP handler taking an API payload from the caseworker's UI.
 */
export const caseworkerAction = async (
  human: HumanPeer,
  itemId: string,
  action: HumanAction,
): Promise<void> => {
  await human.respond(itemId, action);
};

/**
 * Naive high-risk classifier. Real SafeVoice uses a proper classifier
 * (and escalates on many more signals). This is demonstration only —
 * if the message mentions immediate-danger keywords, route to the
 * caseworker; otherwise route to the manager.
 */
export const isHighRisk = (text: string): boolean => {
  const t = text.toLowerCase();
  return (
    t.includes("he's here") ||
    t.includes("he is here") ||
    t.includes("right now") ||
    t.includes("help me") ||
    t.includes("emergency") ||
    t.includes("in danger")
  );
};
