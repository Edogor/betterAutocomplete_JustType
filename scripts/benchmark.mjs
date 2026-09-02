import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaults = {
  endpoint: process.env.JUSTTYPE_LLAMA_ENDPOINT ?? 'http://127.0.0.1:8012',
  runs: 5,
  warmup: 1,
  nPredict: 32,
  timeoutMs: 2_500,
  output: undefined,
  scenarioIds: [],
  strict: false,
  label: undefined,
  model: process.env.JUSTTYPE_MODEL ?? 'unspecified',
  serverLabel: process.env.JUSTTYPE_LLAMA_SERVER ?? 'unspecified'
};

const options = parseArguments(process.argv.slice(2));
const scenariosPath = fileURLToPath(new URL('../benchmarks/scenarios.json', import.meta.url));
const allScenarios = await readScenarios(scenariosPath);
const scenarios = selectScenarios(allScenarios, options.scenarioIds);
const endpoint = normaliseEndpoint(options.endpoint);
const output = options.output ?? defaultOutputPath();
const health = await checkHealth(endpoint, options.timeoutMs);
const results = [];

for (const scenario of scenarios) {
  let warmupFailures = 0;
  for (let run = 0; run < options.warmup; run += 1) {
    const result = await executeInfill(endpoint, scenario, options);
    if (result.status !== 'ok') warmupFailures += 1;
  }

  const runs = [];
  for (let run = 0; run < options.runs; run += 1) {
    runs.push(await executeInfill(endpoint, scenario, options));
  }
  results.push({
    id: scenario.id,
    description: scenario.description,
    warmupFailures,
    runs,
    summary: summarise(runs)
  });
}

const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  label: options.label,
  model: options.model,
  serverLabel: options.serverLabel,
  runtime: runtimeMetadata(),
  endpoint,
  health,
  measurementScope: 'Sequential llama.cpp /infill round trips. In the current non-streaming extension this approximates model time to visible Ghost Text, but excludes VS Code scheduling and user-interaction behaviour.',
  configuration: {
    scenarioCount: scenarios.length,
    measuredRunsPerScenario: options.runs,
    warmupRunsPerScenario: options.warmup,
    nPredict: options.nPredict,
    timeoutMs: options.timeoutMs
  },
  scenarios: results,
  summary: summarise(results.flatMap((scenario) => scenario.runs))
};

if (output === '-') {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const outputPath = resolve(process.cwd(), output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  printSummary(report, outputPath);
}

if (report.summary.failedRuns > 0 || (options.strict && report.summary.expectedMismatches > 0)) process.exitCode = 1;

function parseArguments(args) {
  const parsed = { ...defaults };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    switch (argument) {
      case '--endpoint':
        parsed.endpoint = valueFor(argument, args[++index]);
        break;
      case '--runs':
        parsed.runs = positiveInteger(argument, valueFor(argument, args[++index]));
        break;
      case '--warmup':
        parsed.warmup = nonNegativeInteger(argument, valueFor(argument, args[++index]));
        break;
      case '--n-predict':
        parsed.nPredict = positiveInteger(argument, valueFor(argument, args[++index]));
        break;
      case '--timeout-ms':
        parsed.timeoutMs = positiveInteger(argument, valueFor(argument, args[++index]));
        break;
      case '--output':
        parsed.output = valueFor(argument, args[++index]);
        break;
      case '--scenario':
        parsed.scenarioIds.push(valueFor(argument, args[++index]));
        break;
      case '--label':
        parsed.label = valueFor(argument, args[++index]);
        break;
      case '--model':
        parsed.model = valueFor(argument, args[++index]);
        break;
      case '--server-label':
        parsed.serverLabel = valueFor(argument, args[++index]);
        break;
      case '--strict':
        parsed.strict = true;
        break;
      case '--help':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  return parsed;
}

function valueFor(option, value) {
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(option, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${option} must be a positive integer`);
  return number;
}

function nonNegativeInteger(option, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) throw new Error(`${option} must be a non-negative integer`);
  return number;
}

async function readScenarios(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Benchmark scenarios must be a non-empty JSON array');
  return parsed.map((scenario) => {
    if (!isScenario(scenario)) throw new Error('Benchmark scenario has an invalid shape');
    return scenario;
  });
}

function isScenario(value) {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.description === 'string'
    && typeof value.inputPrefix === 'string'
    && typeof value.prompt === 'string'
    && typeof value.inputSuffix === 'string'
    && Array.isArray(value.expectedAnyOf)
    && value.expectedAnyOf.every((expected) => typeof expected === 'string');
}

function selectScenarios(scenarios, requestedIds) {
  if (requestedIds.length === 0) return scenarios;
  const requested = new Set(requestedIds);
  const selected = scenarios.filter((scenario) => requested.has(scenario.id));
  const unknown = [...requested].filter((id) => !selected.some((scenario) => scenario.id === id));
  if (unknown.length > 0) throw new Error(`Unknown benchmark scenario(s): ${unknown.join(', ')}`);
  return selected;
}

function normaliseEndpoint(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Endpoint must use http or https');
  return url.toString().replace(/\/$/u, '');
}

async function checkHealth(endpoint, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpointUrl(endpoint, '/health'), { signal: controller.signal });
    if (!response.ok) throw new Error(`llama.cpp health check failed with HTTP ${response.status}`);
    const body = await response.json();
    return { ok: true, status: isRecord(body) && typeof body.status === 'string' ? body.status : 'ok' };
  } catch (error) {
    const reason = controller.signal.aborted ? 'timeout' : 'unavailable';
    throw new Error(`llama.cpp health check failed (${reason}): ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function executeInfill(endpoint, scenario, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(endpointUrl(endpoint, '/infill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        input_prefix: scenario.inputPrefix,
        prompt: scenario.prompt,
        input_suffix: scenario.inputSuffix,
        n_predict: options.nPredict,
        stream: false,
        cache_prompt: true,
        temperature: 0.2,
        top_k: 40,
        top_p: 0.95,
        samplers: ['top_k', 'top_p', 'infill'],
        t_max_predict_ms: 1_200
      })
    });
    const latencyMs = Math.round(performance.now() - started);
    if (!response.ok) return { status: `http_${response.status}`, latencyMs };
    const body = await response.json();
    const completion = Array.isArray(body) ? body[0] : body;
    if (!isRecord(completion) || typeof completion.content !== 'string' || !completion.content.trim()) return { status: 'invalid_response', latencyMs };
    const timings = isRecord(completion.timings) ? completion.timings : undefined;
    return {
      status: 'ok',
      latencyMs,
      completionCharacters: completion.content.length,
      expectedMatched: scenario.expectedAnyOf.length === 0 ? null : scenario.expectedAnyOf.some((expected) => completion.content.includes(expected)),
      promptTokens: numberField(timings, 'prompt_n'),
      predictedTokens: numberField(timings, 'predicted_n'),
      predictedTokensPerSecond: numberField(timings, 'predicted_per_second'),
      cachedTokens: numberField(completion, 'tokens_cached')
    };
  } catch {
    return {
      status: controller.signal.aborted ? 'timeout' : 'network_error',
      latencyMs: Math.round(performance.now() - started)
    };
  } finally {
    clearTimeout(timeout);
  }
}

function endpointUrl(endpoint, path) {
  return new URL(path, `${endpoint}/`).toString();
}

function summarise(runs) {
  const successful = runs.filter((run) => run.status === 'ok');
  const checked = successful.filter((run) => typeof run.expectedMatched === 'boolean');
  return {
    totalRuns: runs.length,
    successfulRuns: successful.length,
    failedRuns: runs.length - successful.length,
    expectedChecks: checked.length,
    expectedMatches: checked.filter((run) => run.expectedMatched).length,
    expectedMismatches: checked.filter((run) => !run.expectedMatched).length,
    latencyMs: statistics(successful.map((run) => run.latencyMs)),
    predictedTokensPerSecond: statistics(successful.map((run) => run.predictedTokensPerSecond).filter(Number.isFinite)),
    cachedTokens: statistics(successful.map((run) => run.cachedTokens).filter(Number.isFinite))
  };
}

function statistics(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rounded = (number) => Math.round(number * 100) / 100;
  return {
    min: rounded(sorted[0]),
    p50: rounded(percentile(sorted, 0.5)),
    p90: rounded(percentile(sorted, 0.9)),
    max: rounded(sorted[sorted.length - 1]),
    mean: rounded(sorted.reduce((sum, value) => sum + value, 0) / sorted.length)
  };
}

function percentile(sorted, fraction) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function numberField(value, field) {
  return value && typeof value[field] === 'number' ? value[field] : undefined;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function defaultOutputPath() {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
  return `benchmarks/results/infill-${timestamp}.json`;
}

function runtimeMetadata() {
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCores: cpus.length,
    memoryMiB: Math.round(os.totalmem() / (1024 * 1024))
  };
}

function printSummary(report, outputPath) {
  console.log('JustType inference benchmark');
  for (const scenario of report.scenarios) {
    const summary = scenario.summary;
    const latency = summary.latencyMs ? `p50 ${summary.latencyMs.p50} ms, p90 ${summary.latencyMs.p90} ms` : 'no successful run';
    console.log(`${scenario.id}: ${summary.successfulRuns}/${summary.totalRuns} successful; ${latency}; expected matches ${summary.expectedMatches}/${summary.expectedChecks}`);
  }
  console.log(`Report: ${outputPath}`);
}

function printUsage() {
  console.log(`Usage: npm run benchmark -- [options]

Options:
  --endpoint <url>       llama.cpp server URL (default: JUSTTYPE_LLAMA_ENDPOINT or http://127.0.0.1:8012)
  --runs <count>         Measured runs per scenario (default: 5)
  --warmup <count>       Unrecorded warm-up runs per scenario (default: 1)
  --n-predict <count>    Completion token limit (default: 32)
  --timeout-ms <ms>      Client timeout per request (default: 2500)
  --scenario <id>        Run only this scenario; may be repeated
  --label <name>         Optional comparison label stored in the report
  --model <name>         Model and quantisation label stored in the report
  --server-label <name>  llama.cpp build/flag label stored in the report
  --output <path|->      JSON report path, or - for stdout only
  --strict               Return failure for an expectation mismatch
  --help                 Show this help`);
}
