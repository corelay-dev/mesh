export type AttributionAction = "replied" | "shared" | "clicked" | "joined_rally" | "registered" | "donated";

export interface AttributionEvent {
  supporterId: string;
  messageId: string;
  campaignId: string;
  action: AttributionAction;
  timestamp: Date;
}

export interface AttributionStore {
  record(event: AttributionEvent): Promise<void>;
  getBySupporterId(supporterId: string): Promise<AttributionEvent[]>;
  getByMessage(messageId: string): Promise<AttributionEvent[]>;
  getByCampaign(campaignId: string): Promise<AttributionEvent[]>;
}

export class InMemoryAttributionStore implements AttributionStore {
  private events: AttributionEvent[] = [];

  async record(event: AttributionEvent): Promise<void> {
    this.events.push(event);
  }

  async getBySupporterId(supporterId: string): Promise<AttributionEvent[]> {
    return this.events.filter((e) => e.supporterId === supporterId);
  }

  async getByMessage(messageId: string): Promise<AttributionEvent[]> {
    return this.events.filter((e) => e.messageId === messageId);
  }

  async getByCampaign(campaignId: string): Promise<AttributionEvent[]> {
    return this.events.filter((e) => e.campaignId === campaignId);
  }
}

export async function attributeAction(event: AttributionEvent, store: AttributionStore): Promise<void> {
  await store.record(event);
}
