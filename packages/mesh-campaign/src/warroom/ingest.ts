import { detectAnomaly, type IngestResultInput, type IngestResultOutput } from "./service.js";
import type { DBQuery } from "../memory/campaign-memory.js";

/**
 * Ingests a polling unit result: validates, detects anomalies, stores.
 */
export async function ingestResult(
  db: DBQuery,
  campaignId: string,
  data: IngestResultInput,
): Promise<IngestResultOutput> {
  const anomaly = detectAnomaly(data.results, data.accreditedVoters, data.registeredVoters);

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO pb_results (campaign_id, state, lga, ward, polling_unit, polling_unit_code, results, accredited_voters, registered_voters, source, reported_by, photo_url, is_anomaly, anomaly_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [
      campaignId, data.state, data.lga, data.ward, data.pollingUnit, data.pollingUnitCode,
      JSON.stringify(data.results), data.accreditedVoters, data.registeredVoters,
      data.source, data.reportedBy, data.photoUrl, anomaly.isAnomaly, anomaly.reason,
    ],
  );

  return { id: rows[0]!.id, isAnomaly: anomaly.isAnomaly, anomalyReason: anomaly.reason };
}
