export interface TimeWindow {
  startHour: number;
  endHour: number;
  days: number[]; // 0=Sunday, 6=Saturday
}

export const NIGERIA_OPTIMAL_TIMES: Record<string, TimeWindow[]> = {
  twitter: [
    { startHour: 7, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 12, endHour: 14, days: [1, 2, 3, 4, 6] },
    { startHour: 19, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  instagram: [
    { startHour: 7, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 12, endHour: 14, days: [1, 2, 3, 4, 6] },
    { startHour: 19, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  facebook: [
    { startHour: 7, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 12, endHour: 14, days: [1, 2, 3, 4, 6] },
    { startHour: 19, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  whatsapp_status: [
    { startHour: 7, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 19, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  whatsapp: [
    { startHour: 7, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 12, endHour: 14, days: [1, 2, 3, 4, 6] },
    { startHour: 19, endHour: 22, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
  sms: [
    { startHour: 8, endHour: 9, days: [1, 2, 3, 4, 5, 6] },
    { startHour: 12, endHour: 14, days: [1, 2, 3, 4, 6] },
    { startHour: 19, endHour: 21, days: [0, 1, 2, 3, 4, 5, 6] },
  ],
};

/** Avoid periods: Friday 1-3pm (prayers), Sunday 8-11am (church) */
function isAvoidPeriod(date: Date): boolean {
  const day = date.getDay();
  const hour = date.getHours();
  if (day === 5 && hour >= 13 && hour < 15) return true; // Friday prayers
  if (day === 0 && hour >= 8 && hour < 11) return true; // Sunday church
  return false;
}

export function isOptimalTime(platform: string, date: Date): boolean {
  if (isAvoidPeriod(date)) return false;

  const windows = NIGERIA_OPTIMAL_TIMES[platform];
  if (!windows) return false;

  const day = date.getDay();
  const hour = date.getHours();

  return windows.some((w) => w.days.includes(day) && hour >= w.startHour && hour < w.endHour);
}

export function getNextOptimalTime(platform: string, after?: Date): Date {
  const start = after ? new Date(after.getTime()) : new Date();
  const windows = NIGERIA_OPTIMAL_TIMES[platform];
  if (!windows?.length) return start;

  // Search up to 7 days ahead
  for (let offset = 0; offset < 7 * 24; offset++) {
    const candidate = new Date(start.getTime() + offset * 60 * 60 * 1000);
    if (isOptimalTime(platform, candidate)) {
      return candidate;
    }
  }
  return start;
}
