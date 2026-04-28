import type { LLMUsageReport } from '../types.js';

type Provider = LLMUsageReport['provider'];

export class LLMTracker {
  private readonly productId: string;
  private buffer: LLMUsageReport[] = [];

  constructor(productId: string) {
    this.productId = productId;
  }

  trackCall(
    provider: Provider,
    model: string,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    durationMs: number,
    feature?: string,
  ): void {
    this.buffer.push({
      productId: this.productId,
      timestamp: new Date().toISOString(),
      provider,
      model,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs,
      feature,
    });
  }

  wrapBedrock<T extends object>(client: T): T {
    const tracker = this;
    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== 'send' || typeof value !== 'function') return value;
        return async function (this: T, ...args: unknown[]) {
          const command = args[0] as Record<string, unknown> | undefined;
          const commandName = command?.constructor?.name ?? '';
          if (!commandName.includes('InvokeModel')) {
            return Reflect.apply(value as (...a: unknown[]) => unknown, this, args);
          }
          const start = Date.now();
          const result = await Reflect.apply(value as (...a: unknown[]) => Promise<unknown>, this, args) as Record<string, unknown>;
          const durationMs = Date.now() - start;
          const input = command?.input as Record<string, unknown> | undefined;
          const modelId = (input?.modelId as string) ?? 'unknown';
          const usage = (result?.usage ?? (result as Record<string, unknown>)) as Record<string, number>;
          tracker.trackCall(
            'bedrock',
            modelId,
            usage?.inputTokens ?? 0,
            usage?.outputTokens ?? 0,
            0,
            durationMs,
          );
          return result;
        };
      },
    });
  }

  wrapOpenAI<T extends object>(client: T): T {
    const tracker = this;
    return new Proxy(client, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop !== 'chat' || typeof value !== 'object' || value === null) return value;
        return new Proxy(value as object, {
          get(chatTarget, chatProp, chatReceiver) {
            const chatValue = Reflect.get(chatTarget, chatProp, chatReceiver);
            if (chatProp !== 'completions' || typeof chatValue !== 'object' || chatValue === null) return chatValue;
            return new Proxy(chatValue as object, {
              get(compTarget, compProp, compReceiver) {
                const compValue = Reflect.get(compTarget, compProp, compReceiver);
                if (compProp !== 'create' || typeof compValue !== 'function') return compValue;
                return async function (this: unknown, ...args: unknown[]) {
                  const start = Date.now();
                  const result = await Reflect.apply(compValue as (...a: unknown[]) => Promise<unknown>, this, args) as Record<string, unknown>;
                  const durationMs = Date.now() - start;
                  const params = args[0] as Record<string, unknown> | undefined;
                  const model = (params?.model as string) ?? 'unknown';
                  const usage = result?.usage as Record<string, number> | undefined;
                  tracker.trackCall(
                    'openai',
                    model,
                    usage?.prompt_tokens ?? 0,
                    usage?.completion_tokens ?? 0,
                    0,
                    durationMs,
                  );
                  return result;
                };
              },
            });
          },
        });
      },
    });
  }

  flush(): LLMUsageReport[] {
    const reports = this.buffer;
    this.buffer = [];
    return reports;
  }
}
