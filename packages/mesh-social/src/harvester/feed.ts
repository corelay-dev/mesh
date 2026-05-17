import type { SocialEvent } from "../platforms/types.js";

export function normalizeToIntelInput(events: SocialEvent[]): string[] {
  return events.map(
    (e) => `[${e.platform}] @${e.author} (${e.type}): ${e.content}`,
  );
}
