import type { HealthStatus, InfillRequest, InfillResult } from '../core/types';

export interface InferenceClient {
  health(signal: AbortSignal): Promise<HealthStatus>;
  infill(request: InfillRequest, signal: AbortSignal): Promise<InfillResult>;
}

export class LlamaCppClient implements InferenceClient {
  public constructor(private endpoint: string, private readonly serverPredictMs: number) {}

  public setEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
  }

  public async health(signal: AbortSignal): Promise<HealthStatus> {
    try {
      const response = await fetch(this.url('/health'), { signal });
      if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
      const body: unknown = await response.json();
      const status = isRecord(body) && typeof body.status === 'string' ? body.status : 'ok';
      return { ok: status === 'ok', detail: status };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  public async infill(request: InfillRequest, signal: AbortSignal): Promise<InfillResult> {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const started = performance.now();
    const response = await fetch(this.url('/infill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: combined,
      body: JSON.stringify({
        input_prefix: request.inputPrefix,
        prompt: request.prompt,
        input_suffix: request.inputSuffix,
        n_predict: request.nPredict,
        stream: false,
        cache_prompt: true,
        temperature: 0.2,
        top_k: 40,
        top_p: 0.95,
        samplers: ['top_k', 'top_p', 'infill'],
        t_max_predict_ms: this.serverPredictMs
      })
    });
    if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    const first = Array.isArray(body) ? body[0] : body;
    if (!isRecord(first) || typeof first.content !== 'string') throw new Error('llama.cpp returned no completion content');
    const timings = isRecord(first.timings) ? first.timings : undefined;
    return {
      text: first.content,
      durationMs: Math.round(performance.now() - started),
      promptTokens: numberField(timings, 'prompt_n'),
      predictedTokens: numberField(timings, 'predicted_n'),
      cachedTokens: numberField(first, 'tokens_cached')
    };
  }

  private url(path: string): string {
    return new URL(path, this.endpoint.endsWith('/') ? this.endpoint : `${this.endpoint}/`).toString();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberField(value: Record<string, unknown> | undefined, field: string): number | undefined {
  return value && typeof value[field] === 'number' ? value[field] : undefined;
}
