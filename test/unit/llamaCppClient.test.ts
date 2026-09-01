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

    const client = new LlamaCppClient('http://127.0.0.1:8012', 1_200);
    const result = await client.infill({ inputPrefix: 'def scan():\n', prompt: '    ret', inputSuffix: '', nPredict: 32, timeoutMs: 2_500 }, new AbortController().signal);

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

    const status = await new LlamaCppClient('http://127.0.0.1:8012', 1_200).health(new AbortController().signal);
    assert.deepEqual(status, { ok: false, detail: 'connect ECONNREFUSED' });
  });
});
