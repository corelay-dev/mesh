/**
 * Campaign memory store — queries historical results and supporter data.
 * Accepts a generic DB interface so it's not coupled to a specific driver.
 */

export interface DBQuery {
  query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface HistoricalResult {
  lga: string;
  ward: string;
  results: Record<string, number>;
}

export class CampaignMemoryStore {
  constructor(private db: DBQuery) {}

  async getHistoricalResults(campaignId: string, state: string): Promise<HistoricalResult[]> {
    const { rows } = await this.db.query<{ lga: string; ward: string; results: Record<string, number> }>(
      `SELECT lga, ward, results FROM pb_historical_results
       WHERE state = $1 ORDER BY lga, ward`,
      [state],
    );
    return rows;
  }

  async getSupporterDistribution(campaignId: string): Promise<Array<{ ward: string; count: number }>> {
    const { rows } = await this.db.query<{ ward: string; count: string }>(
      `SELECT ward, COUNT(*)::text as count FROM pb_supporters
       WHERE campaign_id = $1 AND ward IS NOT NULL GROUP BY ward`,
      [campaignId],
    );
    return rows.map((r) => ({ ward: r.ward, count: parseInt(r.count, 10) }));
  }

  async getCampaign(campaignId: string): Promise<{ candidateName: string; state: string; partyCode: string } | null> {
    const { rows } = await this.db.query<{ candidate_name: string; state: string; party_code: string }>(
      "SELECT candidate_name, state, party_code FROM pb_campaigns WHERE id = $1",
      [campaignId],
    );
    if (!rows[0]) return null;
    return { candidateName: rows[0].candidate_name, state: rows[0].state, partyCode: rows[0].party_code };
  }

  async getRecentActivity(campaignId: string): Promise<{
    resultsLast24h: Array<{ lga: string; count: number }>;
    messageStats: Array<{ status: string; count: number }>;
    supporterCounts: Array<{ tier: string; count: number }>;
  }> {
    const [results, messages, supporters] = await Promise.all([
      this.db.query<{ lga: string; count: string }>(
        `SELECT lga, COUNT(*)::text as count FROM pb_results
         WHERE campaign_id = $1 AND reported_at > NOW() - INTERVAL '24 hours' GROUP BY lga`,
        [campaignId],
      ),
      this.db.query<{ status: string; count: string }>(
        `SELECT status, COUNT(*)::text as count FROM pb_messages
         WHERE campaign_id = $1 AND created_at > NOW() - INTERVAL '24 hours' GROUP BY status`,
        [campaignId],
      ),
      this.db.query<{ tier: string; count: string }>(
        `SELECT tier, COUNT(*)::text as count FROM pb_supporters
         WHERE campaign_id = $1 GROUP BY tier`,
        [campaignId],
      ),
    ]);

    return {
      resultsLast24h: results.rows.map((r) => ({ lga: r.lga, count: parseInt(r.count, 10) })),
      messageStats: messages.rows.map((r) => ({ status: r.status, count: parseInt(r.count, 10) })),
      supporterCounts: supporters.rows.map((r) => ({ tier: r.tier, count: parseInt(r.count, 10) })),
    };
  }
}
