export interface ContentSlot {
  id: string;
  platform: string;
  scheduledAt: Date;
  content: string;
  status: "pending" | "published" | "failed";
  campaignId: string;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export class ContentCalendar {
  private slots: Map<string, ContentSlot> = new Map();

  addSlot(slot: ContentSlot): void {
    this.slots.set(slot.id, slot);
  }

  getSlots(range: DateRange): ContentSlot[] {
    return [...this.slots.values()].filter(
      (s) => s.scheduledAt >= range.start && s.scheduledAt <= range.end,
    );
  }

  getNextAvailableSlot(platform: string): ContentSlot | undefined {
    const now = new Date();
    return [...this.slots.values()]
      .filter((s) => s.platform === platform && s.status === "pending" && s.scheduledAt > now)
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
  }

  removeSlot(id: string): boolean {
    return this.slots.delete(id);
  }
}
