export interface SignificanceResult {
  significant: boolean;
  pValue: number;
  zScore: number;
}

export function isSignificant(
  controlRate: number,
  testRate: number,
  sampleSize: number,
  confidenceLevel: number = 0.95,
): SignificanceResult {
  const pooledRate = (controlRate + testRate) / 2;
  const se = Math.sqrt((2 * pooledRate * (1 - pooledRate)) / sampleSize);

  if (se === 0) {
    return { significant: false, pValue: 1, zScore: 0 };
  }

  const zScore = (testRate - controlRate) / se;
  const pValue = 2 * (1 - normalCDF(Math.abs(zScore)));
  const alpha = 1 - confidenceLevel;

  return {
    significant: pValue < alpha,
    pValue,
    zScore,
  };
}

function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX / 2);

  return 0.5 * (1.0 + sign * y);
}
