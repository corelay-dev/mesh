export interface DeliveryRecord {
  messageId: string;
  campaignId: string;
  channel: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  deliveryRate: number;
  readRate: number;
  measuredAt: Date;
}

export interface DeliveryStore {
  record(entry: DeliveryRecord): Promise<void>;
  getByMessage(messageId: string): Promise<DeliveryRecord[]>;
  getByCampaign(campaignId: string): Promise<DeliveryRecord[]>;
}

export class InMemoryDeliveryStore implements DeliveryStore {
  private records: DeliveryRecord[] = [];

  async record(entry: DeliveryRecord): Promise<void> {
    this.records.push(entry);
  }

  async getByMessage(messageId: string): Promise<DeliveryRecord[]> {
    return this.records.filter((r) => r.messageId === messageId);
  }

  async getByCampaign(campaignId: string): Promise<DeliveryRecord[]> {
    return this.records.filter((r) => r.campaignId === campaignId);
  }
}
