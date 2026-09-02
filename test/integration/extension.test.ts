import assert from 'node:assert/strict';
import * as http from 'node:http';
import { describe, it } from 'mocha';
import * as vscode from 'vscode';

describe('JustType extension', () => {
  it('activates for a Python document', async () => {
    const document = await vscode.workspace.openTextDocument({ language: 'python', content: 'class ' });
    await vscode.window.showTextDocument(document);
    const extension = vscode.extensions.getExtension('justtype-local.justtype');
    assert.ok(extension);
    await extension.activate();
    assert.equal(extension.isActive, true);
  });

  it('requests an infill completion from the configured local server', async function () {
    this.timeout(10_000);
    const stub = await createLlamaStub();
    try {
      const extension = vscode.extensions.getExtension('justtype-local.justtype');
      assert.ok(extension);
      await extension.activate();
      await vscode.workspace.getConfiguration('justType').update('llamaCpp.endpoint', stub.endpoint, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('triggerMode', 'manual', vscode.ConfigurationTarget.Global);

      const document = await vscode.workspace.openTextDocument({ language: 'python', content: 'def scan_hosts():\n    ret' });
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(1, 7);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');

      await waitFor(() => stub.infillRequests.length === 1);
      assert.deepEqual(stub.infillRequests[0], {
        input_prefix: 'def scan_hosts():\n',
        prompt: '    ret',
        input_suffix: '',
        n_predict: 32,
        stream: false,
        cache_prompt: true,
        temperature: 0.2,
        top_k: 40,
        top_p: 0.95,
        samplers: ['top_k', 'top_p', 'infill'],
        t_max_predict_ms: 3_000
      });

    } finally {
      await vscode.workspace.getConfiguration('justType').update('llamaCpp.endpoint', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('triggerMode', undefined, vscode.ConfigurationTarget.Global);
      await stub.close();
    }
  });

  it('uses SSE streaming for live continuations at the end of a line', async function () {
    this.timeout(10_000);
    const stub = await createLlamaStub();
    try {
      const extension = vscode.extensions.getExtension('justtype-local.justtype');
      assert.ok(extension);
      await extension.activate();
      await vscode.workspace.getConfiguration('justType').update('llamaCpp.endpoint', stub.endpoint, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('triggerMode', 'manual', vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('completionMode', 'live', vscode.ConfigurationTarget.Global);

      const document = await vscode.workspace.openTextDocument({ language: 'python', content: 'def scan_hosts():\n' });
      const editor = await vscode.window.showTextDocument(document);
      const position = new vscode.Position(1, 0);
      editor.selection = new vscode.Selection(position, position);
      await vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');

      await waitFor(() => stub.infillRequests.length === 1);
      assert.equal(stub.infillRequests[0].stream, true);
      assert.equal(stub.infillRequests[0].n_predict, 512);
      assert.equal(stub.infillRequests[0].t_max_predict_ms, 30_000);
    } finally {
      await vscode.workspace.getConfiguration('justType').update('completionMode', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('llamaCpp.endpoint', undefined, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('justType').update('triggerMode', undefined, vscode.ConfigurationTarget.Global);
      await stub.close();
    }
  });

});

type LlamaStub = {
  endpoint: string;
  infillRequests: Record<string, unknown>[];
  close(): Promise<void>;
};

async function createLlamaStub(): Promise<LlamaStub> {
  const infillRequests: Record<string, unknown>[] = [];
  const server = http.createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/infill') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      infillRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>);
      const body = infillRequests.at(-1);
      if (body?.stream === true) {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: {"content":"return hosts","stop":false}\n\n');
        response.end('data: {"content":"","stop":true,"stop_type":"limit","timings":{"prompt_n":8,"predicted_n":2}}\n\n');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ content: 'urn []', timings: { prompt_n: 8, predicted_n: 3 } }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    infillRequests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 25));
  assert.ok(condition(), 'Timed out waiting for an infill request');
}
