import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'mocha';
import { LlamaCppClient } from '../../src/inference/llamaCppClient';

describe('LlamaCppClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the native llama.cpp infill shape and parses a completion', async () => {
    let requestedUrl = '';
    let requestedBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input, init) => {
      requestedUrl = input.toString();
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ content: 'urn []', timings: { prompt_n: 12, predicted_n: 3 }, tokens_cached: 8 }), { status: 200 });
    }) as typeof fetch;

    const client = new LlamaCppClient('http://127.0.0.1:8012');
    const result = await client.infill({ inputPrefix: 'def scan():\n', prompt: '    ret', inputSuffix: '', nPredict: 32, timeoutMs: 2_500, serverPredictMs: 1_200 }, new AbortController().signal);

    assert.equal(requestedUrl, 'http://127.0.0.1:8012/infill');
    assert.deepEqual(requestedBody, {
      input_prefix: 'def scan():\n',
      prompt: '    ret',
      input_suffix: '',
      n_predict: 32,
      stream: false,
      cache_prompt: true,
      temperature: 0.2,
      top_k: 40,
      top_p: 0.95,
      samplers: ['top_k', 'top_p', 'infill'],
      t_max_predict_ms: 1_200
    });
    assert.equal(result.text, 'urn []');
    assert.equal(result.promptTokens, 12);
    assert.equal(result.predictedTokens, 3);
    assert.equal(result.cachedTokens, 8);
  });

  it('reports an unavailable health endpoint without throwing', async () => {
    globalThis.fetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;

    const status = await new LlamaCppClient('http://127.0.0.1:8012').health(new AbortController().signal);
    assert.deepEqual(status, { ok: false, detail: 'connect ECONNREFUSED' });
  });

  it('streams SSE deltas across byte boundaries and keeps final metadata', async () => {
    let requestedBody: Record<string, unknown> | undefined;
    const payload = [
      'data: {"content":"ret","stop":false}\r\n\r\n',
      'data: {"content":"urn ä","stop":false}\n\n',
      'data: {"content":"","stop":true,"stop_type":"limit","timings":{"prompt_n":12,"predicted_n":4},"tokens_cached":8}\n\n',
      'data: [DONE]\n\n'
    ].join('');
    const bytes = new TextEncoder().encode(payload);
    globalThis.fetch = (async (_input, init) => {
      requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (let index = 0; index < bytes.length; index += 3) controller.enqueue(bytes.slice(index, index + 3));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const deltas: string[] = [];
    const result = await new LlamaCppClient('http://127.0.0.1:8012').streamInfill(
      { inputPrefix: 'def scan():\n', prompt: '    ret', inputSuffix: '', nPredict: 512, timeoutMs: 45_000, serverPredictMs: 30_000 },
      new AbortController().signal,
      (delta) => deltas.push(delta)
    );

    assert.equal(result.text, 'return ä');
    assert.deepEqual(deltas, ['ret', 'urn ä']);
    assert.equal(result.stopReason, 'limit');
    assert.equal(result.promptTokens, 12);
    assert.equal(result.predictedTokens, 4);
    assert.equal(result.cachedTokens, 8);
    assert.equal(requestedBody?.stream, true);
    assert.equal(requestedBody?.n_predict, 512);
    assert.equal(requestedBody?.t_max_predict_ms, 30_000);
  });

  it('rejects HTTP failures and malformed streaming events', async () => {
    const request = { inputPrefix: '', prompt: '', inputSuffix: '', nPredict: 512, timeoutMs: 45_000, serverPredictMs: 30_000 };
    globalThis.fetch = (async () => new Response('offline', { status: 503 })) as typeof fetch;
    await assert.rejects(
      () => new LlamaCppClient('http://127.0.0.1:8012').streamInfill(request, new AbortController().signal, () => undefined),
      /HTTP 503/
    );

    globalThis.fetch = (async () => new Response('data: not-json\n\n', { status: 200 })) as typeof fetch;
    await assert.rejects(
      () => new LlamaCppClient('http://127.0.0.1:8012').streamInfill(request, new AbortController().signal, () => undefined),
      /invalid SSE JSON/
    );
  });
});
