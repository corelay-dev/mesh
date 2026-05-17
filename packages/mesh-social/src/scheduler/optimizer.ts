import { getNextOptimalTime } from "./nigeria-times.js";

export function getOptimalSlots(platform: string, count: number, _timezone?: string): Date[] {
  const slots: Date[] = [];
  let cursor = new Date();

  for (let i = 0; i < count; i++) {
    const next = getNextOptimalTime(platform, cursor);
    slots.push(next);
    // Move cursor 3 hours ahead to avoid clustering
    cursor = new Date(next.getTime() + 3 * 60 * 60 * 1000);
  }

  return slots;
}
