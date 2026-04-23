import { describe, it, expect } from "vitest";
import {
  MemoryInbox,
  PeerRegistry,
  type Address,
  type Message,
  type Peer,
} from "@corelay/mesh-core";
import { HumanPeer } from "../src/human-peer.js";

const sinkPeer = (address: Address): Peer & { received: Message[] } => ({
  address,
  received: [],
  async send(m) {
    (this as unknown as { received: Message[] }).received.push(m);
  },
});

const inboundFrom = (sender: Address, content: string, id = "m-1"): Message => ({
  id,
  from: sender,
  to: "t/caseworker/alice",
  kind: "peer",
  content,
  traceId: "trace-1",
  createdAt: Date.now(),
});

const drain = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe("HumanPeer", () => {
  it("accepts messages into the worklist and exposes them via list()", async () => {
    const registry = new PeerRegistry();
    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "Need review", "m-1"));
    await human.send(inboundFrom("t/caller", "Also this one", "m-2"));
    await drain();

    const items = human.list();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.message.content)).toEqual(["Need review", "Also this one"]);
    expect(items[0]?.id).toBe("m-1");
  });

  it("approve delivers the original content back to the sender", async () => {
    const registry = new PeerRegistry();
    const caller = sinkPeer("t/caller");
    registry.register(caller);

    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "please approve", "m-1"));
    await drain();

    await human.respond("m-1", { decision: "approve", actor: "alice@safevoice" });

    expect(caller.received).toHaveLength(1);
    expect(caller.received[0]?.content).toBe("please approve");
    expect(caller.received[0]?.from).toBe("t/caseworker/alice");
    expect(caller.received[0]?.to).toBe("t/caller");
    const meta = caller.received[0]?.metadata?.human as { decision: string; actor: string };
    expect(meta.decision).toBe("approve");
    expect(meta.actor).toBe("alice@safevoice");

    expect(human.list()).toHaveLength(0);
  });

  it("reject delivers the reason to the sender", async () => {
    const registry = new PeerRegistry();
    const caller = sinkPeer("t/caller");
    registry.register(caller);

    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "please approve", "m-1"));
    await drain();

    await human.respond("m-1", {
      decision: "reject",
      content: "Safety concern — escalate to manager.",
    });

    expect(caller.received[0]?.content).toBe("Safety concern — escalate to manager.");
    expect((caller.received[0]?.metadata?.human as { decision: string }).decision).toBe("reject");
  });

  it("edit delivers the human-edited content", async () => {
    const registry = new PeerRegistry();
    const caller = sinkPeer("t/caller");
    registry.register(caller);

    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "draft reply", "m-1"));
    await drain();

    await human.respond("m-1", {
      decision: "edit",
      content: "Polished reply for the survivor.",
    });

    expect(caller.received[0]?.content).toBe("Polished reply for the survivor.");
    expect((caller.received[0]?.metadata?.human as { decision: string }).decision).toBe("edit");
  });

  it("edit without content throws and leaves the item in the worklist", async () => {
    const registry = new PeerRegistry();
    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "x", "m-1"));
    await drain();

    await expect(
      human.respond("m-1", { decision: "edit" }),
    ).rejects.toThrow(/'edit' requires action.content/);
    expect(human.list()).toHaveLength(1);
  });

  it("reassign forwards the original content to a new address", async () => {
    const registry = new PeerRegistry();
    const caller = sinkPeer("t/caller");
    const manager = sinkPeer("t/manager");
    registry.register(caller);
    registry.register(manager);

    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "complex case", "m-1"));
    await drain();

    await human.respond("m-1", { decision: "reassign", reassignTo: "t/manager" });

    expect(caller.received).toHaveLength(0);
    expect(manager.received).toHaveLength(1);
    expect(manager.received[0]?.content).toBe("complex case");
    expect(manager.received[0]?.to).toBe("t/manager");
    expect((manager.received[0]?.metadata?.human as { decision: string }).decision).toBe("reassign");
  });

  it("reassign without target throws and leaves the item in the worklist", async () => {
    const registry = new PeerRegistry();
    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await human.send(inboundFrom("t/caller", "x", "m-1"));
    await drain();

    await expect(
      human.respond("m-1", { decision: "reassign" }),
    ).rejects.toThrow(/'reassign' requires action.reassignTo/);
    expect(human.list()).toHaveLength(1);
  });

  it("respond on an unknown item throws", async () => {
    const registry = new PeerRegistry();
    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    await expect(
      human.respond("never-seen", { decision: "approve" }),
    ).rejects.toThrow(/no pending item with id "never-seen"/);
  });

  it("preserves the original message's traceId on the reply", async () => {
    const registry = new PeerRegistry();
    const caller = sinkPeer("t/caller");
    registry.register(caller);

    const human = new HumanPeer({
      address: "t/caseworker/alice",
      inbox: new MemoryInbox(),
      registry,
    });
    registry.register(human);
    await human.start();

    const msg: Message = {
      id: "m-1",
      from: "t/caller",
      to: "t/caseworker/alice",
      kind: "peer",
      content: "x",
      traceId: "trace-xyz",
      createdAt: 0,
    };
    await human.send(msg);
    await drain();

    await human.respond("m-1", { decision: "approve" });
    expect(caller.received[0]?.traceId).toBe("trace-xyz");
  });
});
