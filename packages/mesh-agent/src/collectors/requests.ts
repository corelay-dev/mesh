import type { RequestMetric } from '../types.js';

interface ExpressRequest {
  method: string;
  originalUrl?: string;
  url?: string;
}

interface ExpressResponse {
  statusCode: number;
  on(event: string, listener: () => void): void;
}

export class RequestTracker {
  private readonly productId: string;
  private buffer: RequestMetric[] = [];

  constructor(productId: string) {
    this.productId = productId;
  }

  trackRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    this.buffer.push({
      productId: this.productId,
      timestamp: new Date().toISOString(),
      method,
      path,
      statusCode,
      durationMs,
    });
  }

  expressMiddleware(): (req: ExpressRequest, res: ExpressResponse, next: () => void) => void {
    return (req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        try {
          this.trackRequest(req.method, req.originalUrl ?? req.url ?? '/', res.statusCode, Date.now() - start);
        } catch {}
      });
      next();
    };
  }

  flush(): RequestMetric[] {
    const reports = this.buffer;
    this.buffer = [];
    return reports;
  }
}
