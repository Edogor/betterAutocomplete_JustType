const endpoint = process.env.JUSTTYPE_LLAMA_ENDPOINT ?? 'http://127.0.0.1:8012';
const baseUrl = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;

const health = await fetch(new URL('/health', baseUrl));
if (!health.ok) throw new Error(`llama.cpp health check failed with HTTP ${health.status}`);

const started = performance.now();
const response = await fetch(new URL('/infill', baseUrl), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    input_prefix: 'def normalize_host(host: str) -> str:\n    ',
    prompt: 'return ',
    input_suffix: '\n',
    n_predict: 32,
    stream: false,
    cache_prompt: true,
    temperature: 0.2,
    top_k: 40,
    top_p: 0.95,
    samplers: ['top_k', 'top_p', 'infill'],
    t_max_predict_ms: 1_200
  })
});
if (!response.ok) throw new Error(`llama.cpp infill failed with HTTP ${response.status}: ${await response.text()}`);

const body = await response.json();
const first = Array.isArray(body) ? body[0] : body;
if (!first || typeof first.content !== 'string' || !first.content.trim()) throw new Error('llama.cpp returned an empty infill completion');

console.log(JSON.stringify({
  endpoint,
  completion: first.content,
  roundTripMs: Math.round(performance.now() - started),
  promptTokens: first.timings?.prompt_n,
  predictedTokens: first.timings?.predicted_n,
  predictedTokensPerSecond: first.timings?.predicted_per_second,
  cachedTokens: first.tokens_cached
}, null, 2));
