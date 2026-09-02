globalThis.fetch = async (input, init) => {
  const url = input.toString();
  if (url.endsWith('/health')) {
    return new globalThis.Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  }
  if (url.endsWith('/infill')) {
    const body = JSON.parse(String(init?.body));
    if (body.input_prefix !== 'def normalize_host(host: str) -> str:\n    ' || body.prompt !== 'return ' || body.input_suffix !== '\n') {
      throw new Error('Unexpected benchmark infill request');
    }
    return new globalThis.Response(JSON.stringify({ content: 'host.lower()', timings: { prompt_n: 10, predicted_n: 4, predicted_per_second: 8.5 }, tokens_cached: 6 }), { status: 200 });
  }
  return new globalThis.Response(null, { status: 404 });
};
