export async function register(commandCenterUrl: string, productId: string, apiKey?: string): Promise<void> {
  try {
    const url = `${commandCenterUrl.replace(/\/$/, '')}/api/register`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        productId,
        timestamp: new Date().toISOString(),
        version: process.version,
        hosting: process.env['RAILWAY_ENVIRONMENT'] ? 'railway'
          : process.env['RENDER_SERVICE_ID'] ? 'render'
          : process.env['AWS_REGION'] ? 'aws'
          : 'unknown',
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {}
}
