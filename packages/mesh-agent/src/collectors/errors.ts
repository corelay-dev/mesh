import type { ErrorReport } from '../types.js';

export class ErrorCollector {
  private readonly productId: string;
  private buffer: ErrorReport[] = [];
  private uncaughtHandler: ((err: Error) => void) | null = null;
  private rejectionHandler: ((reason: unknown) => void) | null = null;

  constructor(productId: string) {
    this.productId = productId;
  }

  addError(error: Error | string, context?: Record<string, unknown>): void {
    const err = typeof error === 'string' ? new Error(error) : error;
    this.buffer.push({
      productId: this.productId,
      timestamp: new Date().toISOString(),
      error: err.message,
      stack: err.stack,
      context,
    });
  }

  start(): void {
    this.uncaughtHandler = (err: Error) => {
      this.addError(err, { type: 'uncaughtException' });
    };
    this.rejectionHandler = (reason: unknown) => {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      this.addError(err, { type: 'unhandledRejection' });
    };
    process.on('uncaughtException', this.uncaughtHandler);
    process.on('unhandledRejection', this.rejectionHandler);
  }

  stop(): void {
    if (this.uncaughtHandler) {
      process.removeListener('uncaughtException', this.uncaughtHandler);
      this.uncaughtHandler = null;
    }
    if (this.rejectionHandler) {
      process.removeListener('unhandledRejection', this.rejectionHandler);
      this.rejectionHandler = null;
    }
  }

  flush(): ErrorReport[] {
    const reports = this.buffer;
    this.buffer = [];
    return reports;
  }
}
