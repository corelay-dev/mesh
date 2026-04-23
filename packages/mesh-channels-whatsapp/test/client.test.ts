import { describe, it, expect, vi } from "vitest";
import { PeerRegistry, type Message } from "@corelay/mesh-core";
import { WhatsAppClient, userPeer } from "../src/client.js";

const makeFetch = (response: { ok: boolean; status?: number; text?: string }) => {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? 200,
    statusText: response.ok ? "OK" : "Bad Request",
    async text() {
      return response.text ?? "";
    },
  });
};

describe("WhatsAppClient.sendText", () => {
  it("POSTs to the Meta messages endpoint with the right body", async () => {
    const fetchStub = makeFetch({ ok: true });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "PNID",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    await client.sendText({ to: "447911123456", text: "hello" });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/PNID/messages");

    const opts = init as { method: string; headers: Record<string, string>; body: string };
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer TOKEN");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(opts.body)).toEqual({
      messaging_product: "whatsapp",
      to: "447911123456",
      type: "text",
      text: { body: "hello" },
    });
  });

  it("uses the per-call phoneNumberId when provided", async () => {
    const fetchStub = makeFetch({ ok: true });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "DEFAULT",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    await client.sendText({ to: "447911123456", text: "hi", phoneNumberId: "OVERRIDE" });

    const [url] = fetchStub.mock.calls[0]!;
    expect(url).toContain("/OVERRIDE/messages");
  });

  it("throws on non-2xx responses with the status in the error", async () => {
    const fetchStub = makeFetch({ ok: false, status: 400, text: '{"error":"bad"}' });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "PNID",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    await expect(client.sendText({ to: "1", text: "x" })).rejects.toThrow(/400/);
  });

  it("respects a custom Graph API version", async () => {
    const fetchStub = makeFetch({ ok: true });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "PNID",
      graphVersion: "v20.0",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    await client.sendText({ to: "1", text: "x" });
    const [url] = fetchStub.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v20.0/PNID/messages");
  });
});

describe("userPeer", () => {
  it("sends the message text to the extracted phone number", async () => {
    const fetchStub = makeFetch({ ok: true });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "PNID",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    const registry = new PeerRegistry();
    const peer = userPeer({ address: "whatsapp/447911123456", client });
    registry.register(peer);

    const reply: Message = {
      id: "reply-1",
      from: "safevoice/triage",
      to: "whatsapp/447911123456",
      kind: "assistant",
      content: "Hello back",
      traceId: "trace-1",
      createdAt: 0,
    };
    await registry.deliver(reply);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchStub.mock.calls[0]![1] as { body: string }).body);
    expect(body.to).toBe("447911123456");
    expect(body.text.body).toBe("Hello back");
  });

  it("uses the per-message phoneNumberId in metadata when present", async () => {
    const fetchStub = makeFetch({ ok: true });
    const client = new WhatsAppClient({
      accessToken: "TOKEN",
      defaultPhoneNumberId: "DEFAULT",
      fetchImpl: fetchStub as unknown as typeof globalThis.fetch,
    });

    const peer = userPeer({ address: "whatsapp/447911123456", client });
    const reply: Message = {
      id: "reply-1",
      from: "safevoice/triage",
      to: "whatsapp/447911123456",
      kind: "assistant",
      content: "hi",
      traceId: "trace-1",
      createdAt: 0,
      metadata: { whatsapp: { phoneNumberId: "FROM_META" } },
    };
    await peer.send(reply);

    const [url] = fetchStub.mock.calls[0]!;
    expect(url).toContain("/FROM_META/messages");
  });

  it("rejects addresses that are not in whatsapp/<phone> form", () => {
    const client = new WhatsAppClient({
      accessToken: "T",
      defaultPhoneNumberId: "P",
      fetchImpl: makeFetch({ ok: true }) as unknown as typeof globalThis.fetch,
    });
    expect(() => userPeer({ address: "safevoice/triage", client })).toThrow(
      /expected 'whatsapp\/<phone>'/,
    );
  });
});
