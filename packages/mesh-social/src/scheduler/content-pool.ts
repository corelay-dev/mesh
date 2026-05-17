export interface ContentPoolItem {
  id: string;
  campaignId: string;
  content: string;
  platform: string;
  language: string;
  createdAt: Date;
  priority: number;
}

export interface ContentPool {
  add(item: ContentPoolItem): void;
  getNext(platform: string): ContentPoolItem | undefined;
  size(platform?: string): number;
  drain(platform: string, count: number): ContentPoolItem[];
}

export class InMemoryContentPool implements ContentPool {
  private items: ContentPoolItem[] = [];

  add(item: ContentPoolItem): void {
    this.items.push(item);
    this.items.sort((a, b) => b.priority - a.priority);
  }

  getNext(platform: string): ContentPoolItem | undefined {
    const idx = this.items.findIndex((i) => i.platform === platform);
    if (idx === -1) return undefined;
    return this.items.splice(idx, 1)[0];
  }

  size(platform?: string): number {
    if (!platform) return this.items.length;
    return this.items.filter((i) => i.platform === platform).length;
  }

  drain(platform: string, count: number): ContentPoolItem[] {
    const result: ContentPoolItem[] = [];
    for (let i = 0; i < count; i++) {
      const item = this.getNext(platform);
      if (!item) break;
      result.push(item);
    }
    return result;
  }
}
