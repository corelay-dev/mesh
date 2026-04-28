import type { TelemetryPayload } from '../types.js';

export class HttpTransport {
  private readonly url: string;
  private readonly apiKey?: string;

  constructor(commandCenterUrl: string, apiKey?: string) {
    this.url = `${commandCenterUrl.replace(/\/$/, '')}/api/telemetry`;
    this.apiKey = apiKey;
  }

  async send(payload: TelemetryPayload): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
        const res = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 5_000));
          continue;
        }
      } catch {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 5_000));
          continue;
        }
      }
    }
  }
}
