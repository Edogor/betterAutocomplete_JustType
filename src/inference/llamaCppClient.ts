import type { HealthStatus, InfillRequest, InfillResult, InfillStopReason, StreamInfillResult } from '../core/types';

export interface InferenceClient {
  health(signal: AbortSignal): Promise<HealthStatus>;
  infill(request: InfillRequest, signal: AbortSignal): Promise<InfillResult>;
  streamInfill(request: InfillRequest, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamInfillResult>;
}

export class LlamaCppClient implements InferenceClient {
  public constructor(private endpoint: string) {}

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
        t_max_predict_ms: request.serverPredictMs
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

  public async streamInfill(request: InfillRequest, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamInfillResult> {
    const timeout = AbortSignal.timeout(request.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    const started = performance.now();
    const response = await fetch(this.url('/infill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      signal: combined,
      body: JSON.stringify({
        input_prefix: request.inputPrefix,
        prompt: request.prompt,
        input_suffix: request.inputSuffix,
        n_predict: request.nPredict,
        stream: true,
        cache_prompt: true,
        temperature: 0.2,
        top_k: 40,
        top_p: 0.95,
        samplers: ['top_k', 'top_p', 'infill'],
        t_max_predict_ms: request.serverPredictMs
      })
    });
    if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`);
    if (!response.body) throw new Error('llama.cpp returned an empty streaming body');

    let text = '';
    let final: Record<string, unknown> | undefined;
    await readSse(response.body, (data) => {
      if (data === '[DONE]') return;
      let event: unknown;
      try {
        event = JSON.parse(data);
      } catch {
        throw new Error('llama.cpp returned invalid SSE JSON');
      }
      if (!isRecord(event)) throw new Error('llama.cpp returned an invalid SSE event');
      const content = typeof event.content === 'string' ? event.content : '';
      if (event.stop === true) {
        final = event;
        if (content) {
          const extra = terminalContent(text, content);
          if (extra) {
            text += extra;
            onDelta(extra);
          }
        }
        return;
      }
      if (content) {
        text += content;
        onDelta(content);
      }
    });

    const timings = final && isRecord(final.timings) ? final.timings : undefined;
    return {
      text,
      durationMs: Math.round(performance.now() - started),
      promptTokens: numberField(timings, 'prompt_n'),
      predictedTokens: numberField(timings, 'predicted_n'),
      cachedTokens: numberField(final, 'tokens_cached'),
      stopReason: stopReason(final?.stop_type)
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

function stopReason(value: unknown): InfillStopReason {
  return value === 'eos' || value === 'limit' || value === 'word' ? value : 'unknown';
}

function terminalContent(current: string, terminal: string): string {
  if (!current) return terminal;
  if (terminal.startsWith(current)) return terminal.slice(current.length);
  return current.endsWith(terminal) ? '' : terminal;
}

async function readSse(stream: ReadableStream<Uint8Array>, onEvent: (data: string) => void): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let dataLines: string[] = [];

  const dispatch = (): void => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    dataLines = [];
    onEvent(data);
  };

  const consume = (flush: boolean): void => {
    while (true) {
      const newline = pending.indexOf('\n');
      if (newline === -1) break;
      const rawLine = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line) {
        dispatch();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (flush && pending) {
      const line = pending.endsWith('\r') ? pending.slice(0, -1) : pending;
      pending = '';
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      consume(false);
    }
    pending += decoder.decode();
    consume(true);
    dispatch();
  } finally {
    reader.releaseLock();
  }
}
