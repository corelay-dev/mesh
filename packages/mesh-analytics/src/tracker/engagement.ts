export interface EngagementRecord {
  messageId: string;
  campaignId: string;
  platform: string;
  likes: number;
  replies: number;
  shares: number;
  impressions: number;
  clickThroughRate: number;
  measuredAt: Date;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface EngagementStore {
  record(entry: EngagementRecord): Promise<void>;
  getByMessage(messageId: string): Promise<EngagementRecord[]>;
  getByCampaign(campaignId: string, dateRange?: DateRange): Promise<EngagementRecord[]>;
  getTopPerforming(campaignId: string, limit: number): Promise<EngagementRecord[]>;
}

export class InMemoryEngagementStore implements EngagementStore {
  private records: EngagementRecord[] = [];

  async record(entry: EngagementRecord): Promise<void> {
    this.records.push(entry);
  }

  async getByMessage(messageId: string): Promise<EngagementRecord[]> {
    return this.records.filter((r) => r.messageId === messageId);
  }

  async getByCampaign(campaignId: string, dateRange?: DateRange): Promise<EngagementRecord[]> {
    return this.records.filter((r) => {
      if (r.campaignId !== campaignId) return false;
      if (dateRange) {
        return r.measuredAt >= dateRange.from && r.measuredAt <= dateRange.to;
      }
      return true;
    });
  }

  async getTopPerforming(campaignId: string, limit: number): Promise<EngagementRecord[]> {
    return this.records
      .filter((r) => r.campaignId === campaignId)
      .sort((a, b) => (b.likes + b.replies + b.shares) - (a.likes + a.replies + a.shares))
      .slice(0, limit);
  }
}
