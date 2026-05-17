import type { ResultSource } from "../schemas/result.js";
import type { DBQuery } from "../memory/campaign-memory.js";

export interface AggregatedResult {
  level: "ward" | "lga" | "state";
  name: string;
  parent: string | null;
  results: Record<string, number>;
  pollingUnitsReported: number;
  pollingUnitsTotal: number;
  coverage: number;
  anomalyCount: number;
}

export interface WarRoomDashboard {
  state: AggregatedResult;
  lgas: AggregatedResult[];
  recentResults: Array<{ pollingUnit: string; ward: string; lga: string; results: Record<string, number>; reportedAt: Date }>;
  anomalies: Array<{ pollingUnit: string; reason: string; results: Record<string, number> }>;
  agentStatus: { total: number; reported: number; silent: number };
}

export interface IngestResultInput {
  state: string;
  lga: string;
  ward: string;
  pollingUnit: string;
  pollingUnitCode: string;
  results: Record<string, number>;
  accreditedVoters: number | null;
  registeredVoters: number | null;
  source: ResultSource;
  reportedBy: string;
  photoUrl: string | null;
}

export interface IngestResultOutput {
  id: string;
  isAnomaly: boolean;
  anomalyReason: string | null;
}

const ANOMALY_THRESHOLDS = {
  turnoutCeiling: 0.95,
  singlePartyFloor: 0.90,
  minVotesForCheck: 50,
};

export function detectAnomaly(
  results: Record<string, number>,
  accredited: number | null,
  registered: number | null,
): { isAnomaly: boolean; reason: string | null } {
  const totalVotes = Object.values(results).reduce((a, b) => a + b, 0);
  if (totalVotes < ANOMALY_THRESHOLDS.minVotesForCheck) {
    return { isAnomaly: false, reason: null };
  }

  if (registered && accredited && accredited / registered > ANOMALY_THRESHOLDS.turnoutCeiling) {
    return { isAnomaly: true, reason: `Suspiciously high turnout: ${((accredited / registered) * 100).toFixed(1)}%` };
  }

  if (accredited && totalVotes > accredited) {
    return { isAnomaly: true, reason: `Votes (${totalVotes}) exceed accredited voters (${accredited})` };
  }

  const maxPartyVotes = Math.max(...Object.values(results));
  if (totalVotes > 0 && maxPartyVotes / totalVotes > ANOMALY_THRESHOLDS.singlePartyFloor) {
    const winner = Object.entries(results).find(([, v]) => v === maxPartyVotes);
    return { isAnomaly: true, reason: `${winner?.[0]} has ${((maxPartyVotes / totalVotes) * 100).toFixed(1)}% — possible ballot stuffing` };
  }

  return { isAnomaly: false, reason: null };
}

/**
 * Aggregates election results into a war room dashboard.
 * Properly sums vote tallies per party at LGA and state level.
 */
export async function getDashboard(db: DBQuery, campaignId: string): Promise<WarRoomDashboard> {
  const { rows: campaign } = await db.query<{ state: string }>(
    "SELECT state FROM pb_campaigns WHERE id = $1",
    [campaignId],
  );
  if (!campaign[0]) throw new Error("Campaign not found");

  const [puResults, recent, anomalies, wardCounts, agentCount] = await Promise.all([
    // Get all results with their LGA for aggregation
    db.query<{ lga: string; results: Record<string, number>; is_anomaly: boolean }>(
      "SELECT lga, results, is_anomaly FROM pb_results WHERE campaign_id = $1",
      [campaignId],
    ),
    db.query<{ polling_unit: string; ward: string; lga: string; results: Record<string, number>; reported_at: Date }>(
      "SELECT polling_unit, ward, lga, results, reported_at FROM pb_results WHERE campaign_id = $1 ORDER BY reported_at DESC LIMIT 20",
      [campaignId],
    ),
    db.query<{ polling_unit: string; anomaly_reason: string; results: Record<string, number> }>(
      "SELECT polling_unit, anomaly_reason, results FROM pb_results WHERE campaign_id = $1 AND is_anomaly = true ORDER BY reported_at DESC LIMIT 50",
      [campaignId],
    ),
    db.query<{ total: string }>(
      "SELECT COUNT(*)::text AS total FROM pb_wards WHERE state = $1",
      [campaign[0].state],
    ),
    db.query<{ total: string; reported: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM pb_supporters WHERE campaign_id = $1 AND tier = 'agent') AS total,
         (SELECT COUNT(DISTINCT reported_by)::text FROM pb_results WHERE campaign_id = $1) AS reported`,
      [campaignId],
    ),
  ]);

  // Aggregate votes per party per LGA
  const lgaMap = new Map<string, { results: Record<string, number>; puCount: number; anomalyCount: number }>();
  const stateResults: Record<string, number> = {};

  for (const row of puResults.rows) {
    const entry = lgaMap.get(row.lga) ?? { results: {}, puCount: 0, anomalyCount: 0 };
    entry.puCount += 1;
    if (row.is_anomaly) entry.anomalyCount += 1;

    // Sum votes per party
    for (const [party, votes] of Object.entries(row.results)) {
      const v = typeof votes === "number" ? votes : parseInt(String(votes), 10);
      entry.results[party] = (entry.results[party] ?? 0) + v;
      stateResults[party] = (stateResults[party] ?? 0) + v;
    }

    lgaMap.set(row.lga, entry);
  }

  const totalWards = parseInt(wardCounts.rows[0]?.total ?? "0", 10);
  const totalPU = puResults.rows.length;
  const totalAnomalies = puResults.rows.filter((r) => r.is_anomaly).length;

  const lgas: AggregatedResult[] = Array.from(lgaMap.entries()).map(([lga, data]) => ({
    level: "lga" as const,
    name: lga,
    parent: campaign[0]!.state,
    results: data.results,
    pollingUnitsReported: data.puCount,
    pollingUnitsTotal: 0, // Would need per-LGA ward data to fill
    coverage: 0,
    anomalyCount: data.anomalyCount,
  }));

  const agentTotal = parseInt(agentCount.rows[0]?.total ?? "0", 10);
  const agentReported = parseInt(agentCount.rows[0]?.reported ?? "0", 10);

  return {
    state: {
      level: "state",
      name: campaign[0].state,
      parent: null,
      results: stateResults,
      pollingUnitsReported: totalPU,
      pollingUnitsTotal: totalWards,
      coverage: totalWards > 0 ? totalPU / totalWards : 0,
      anomalyCount: totalAnomalies,
    },
    lgas,
    recentResults: recent.rows.map((r) => ({
      pollingUnit: r.polling_unit, ward: r.ward, lga: r.lga, results: r.results, reportedAt: r.reported_at,
    })),
    anomalies: anomalies.rows.map((r) => ({
      pollingUnit: r.polling_unit, reason: r.anomaly_reason, results: r.results,
    })),
    agentStatus: { total: agentTotal, reported: agentReported, silent: agentTotal - agentReported },
  };
}
