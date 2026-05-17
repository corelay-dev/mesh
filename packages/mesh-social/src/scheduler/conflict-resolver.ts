import type { ContentSlot } from "./calendar.js";
import { getNextOptimalTime } from "./nigeria-times.js";

const COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

export function resolveConflicts(slots: ContentSlot[]): ContentSlot[] {
  const sorted = [...slots].sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
  const result: ContentSlot[] = [];
  const lastPosted = new Map<string, Date>();

  for (const slot of sorted) {
    const last = lastPosted.get(slot.platform);
    if (last && slot.scheduledAt.getTime() - last.getTime() < COOLDOWN_MS) {
      // Push to next optimal time after cooldown
      const afterCooldown = new Date(last.getTime() + COOLDOWN_MS);
      const adjusted = getNextOptimalTime(slot.platform, afterCooldown);
      result.push({ ...slot, scheduledAt: adjusted });
      lastPosted.set(slot.platform, adjusted);
    } else {
      result.push(slot);
      lastPosted.set(slot.platform, slot.scheduledAt);
    }
  }

  return result;
}
