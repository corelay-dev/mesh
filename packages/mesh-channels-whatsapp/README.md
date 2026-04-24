# @corelay/mesh-channels-whatsapp

WhatsApp Cloud API channel adapter for [Corelay Mesh](https://github.com/corelay-dev/mesh).

Turns inbound WhatsApp webhooks into Mesh `Message`s and sends outbound messages via the Cloud API. Framework-agnostic — wire it into Express, Fastify, or a raw Node HTTP server.

## Install

```sh
npm install @corelay/mesh-channels-whatsapp
```

## API

### `parseWebhookBody(body: unknown): ParsedInbound[]`

Parses the raw Meta webhook JSON payload into structured inbound entries.

### `toMessage(parsed: ParsedInbound): Message`

Converts a parsed inbound entry into a Mesh `Message`.

### `handleWebhook(config: HandleWebhookConfig, req: WebhookRequest): WebhookResponse`

Full webhook handler. Accepts a config object and a framework-agnostic request, returns a `WebhookResponse`. Always responds with `200` on POST requests to prevent Meta from retrying delivery.

### `WhatsAppClient`

Sends outbound messages through the Cloud API. Configured with `accessToken` and `defaultPhoneNumberId`.

```ts
import { WhatsAppClient } from "@corelay/mesh-channels-whatsapp";

const client = new WhatsAppClient({ accessToken: "...", defaultPhoneNumberId: "..." });
```

### `userPeer(config: UserPeerConfig): Peer`

Creates a `Peer` representing a WhatsApp user. Users are addressed as `whatsapp/<phoneNumberE164>` (no `+` prefix).

## Setup

1. Create a WhatsApp Business app in the Meta Developer Portal.
2. Point the webhook URL at your deployment.
3. Provide `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_PHONE_NUMBER_ID`.
4. Pass requests through to `handleWebhook`.

## License

MIT © [Corelay Ltd](https://github.com/corelay-dev)
