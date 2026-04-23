# @corelay/mesh-channels-whatsapp

WhatsApp Cloud API channel for Corelay Mesh.

**Status: Week 2 — in development.**

## What it does

Turns inbound WhatsApp messages into `@corelay/mesh-core` `Message`s and outbound `Message`s into WhatsApp API calls.

- **Inbound**: `handleWebhook(req)` parses a Meta Cloud API webhook, builds a `Message`, delivers it via a `PeerRegistry`.
- **Outbound**: `UserPeer` is a `Peer` representing the WhatsApp user; its `send()` calls Meta's messages API.

The channel is framework-agnostic: `handleWebhook` takes a parsed body + method + query and returns a response. Wire it into Express, Fastify, Remix, or a raw Node HTTP server — your choice.

## Peer addressing

WhatsApp users are addressed as `whatsapp/${phoneNumber}` — for example `whatsapp/447911123456`. The full E.164 number, no `+`. The agent you want to talk to is configured by the caller.

## Setup

1. Meta Developer Portal → create a WhatsApp Business app.
2. Point the webhook at your deployment's `/webhook/whatsapp` URL.
3. Set `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` in env.
4. Wire `handleWebhook` into your HTTP framework.

More to come in the full docs once the package ships.
