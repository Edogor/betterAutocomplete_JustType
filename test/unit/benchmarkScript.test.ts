import assert from 'node:assert/strict';
import { execFile as executeFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, it } from 'mocha';

const execFile = promisify(executeFile);

describe('benchmark script', () => {
  const resources: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(resources.splice(0).map((dispose) => dispose()));
  });

  it('writes aggregate benchmark data without storing prompts or completions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'justtype-benchmark-'));
    resources.push(() => rm(directory, { recursive: true, force: true }));
    const output = join(directory, 'report.json');

    await execFile(process.execPath, ['--require', './test/fixtures/benchmarkFetchStub.cjs', 'scripts/benchmark.mjs', '--endpoint', 'http://benchmark.test', '--scenario', 'normalize-host', '--warmup', '1', '--runs', '2', '--model', 'test-model-q8', '--server-label', 'test-server', '--output', output], { cwd: process.cwd() });

    const report = JSON.parse(await readFile(output, 'utf8')) as Record<string, unknown>;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.endpoint, 'http://benchmark.test');
    assert.equal(report.model, 'test-model-q8');
    assert.equal(report.serverLabel, 'test-server');
    assert.equal(typeof (report.runtime as Record<string, unknown>).cpuModel, 'string');
    assert.match(String(report.measurementScope), /infill/u);
    assert.equal(JSON.stringify(report).includes('input_prefix'), false);
    assert.equal(JSON.stringify(report).includes('host.lower()'), false);
    const summary = report.summary as Record<string, unknown>;
    assert.equal(summary.successfulRuns, 2);
    assert.equal(summary.expectedMatches, 2);
  });
});
