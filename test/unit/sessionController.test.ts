import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'mocha';
import type * as vscode from 'vscode';
import { SessionMetrics } from '../../src/core/metrics';
import type { CompletionPolicy, InfillRequest, InfillResult, StreamInfillResult } from '../../src/core/types';
import type { InferenceClient } from '../../src/inference/llamaCppClient';
import {
  MockCancellationToken,
  MockOutputChannel,
  MockPosition,
  MockStatusBarItem,
  MockTextDocument,
  asCancellationToken,
  asPosition,
  asTextDocument,
  createMockEditor,
  loadSessionController,
  moveMockEditor,
  resetVscodeMock,
  setConfiguration,
  vscodeMock
} from '../helpers/vscodeMock';

const { CompletionSessionController } = loadSessionController();

const policy: CompletionPolicy = {
  prefixChars: 100,
  suffixChars: 20,
  nPredict: 32,
  requestTimeoutMs: 1_000,
  serverPredictMs: 500,
  debounceMs: 0,
  structuralDebounceMs: 0,
  maxVisibleLines: 2,
  cacheCapacity: 8,
  cacheTtlMs: 60_000,
  liveNPredict: 512,
  liveRequestTimeoutMs: 45_000,
  liveServerPredictMs: 30_000,
  liveDebounceMs: 0,
  liveRefreshMs: 1
};

class StubInferenceClient implements InferenceClient {
  public readonly requests: InfillRequest[] = [];
  public readonly signals: AbortSignal[] = [];
  public readonly streamRequests: InfillRequest[] = [];
  public readonly streamSignals: AbortSignal[] = [];
  private readonly responses: Array<Promise<InfillResult>> = [];
  private readonly streams: Array<(onDelta: (delta: string) => void) => Promise<StreamInfillResult>> = [];

  public enqueue(result: InfillResult | Promise<InfillResult>): void {
    this.responses.push(Promise.resolve(result));
  }

  public enqueueStream(run: (onDelta: (delta: string) => void) => Promise<StreamInfillResult>): void {
    this.streams.push(run);
  }

  public async health(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'ok' };
  }

  public infill(request: InfillRequest, signal: AbortSignal): Promise<InfillResult> {
    this.requests.push(request);
    this.signals.push(signal);
    const response = this.responses.shift();
    if (!response) throw new Error('No stubbed infill response');
    return response;
  }

  public streamInfill(request: InfillRequest, signal: AbortSignal, onDelta: (delta: string) => void): Promise<StreamInfillResult> {
    this.streamRequests.push(request);
    this.streamSignals.push(signal);
    const stream = this.streams.shift();
    if (!stream) throw new Error('No stubbed stream response');
    return stream(onDelta);
  }
}

afterEach(() => resetVscodeMock());

describe('CompletionSessionController', () => {
  it('keeps a session-owned request alive after provider cancellation and retriggers native ghost text', async () => {
    const { document, position, editor, controller, client } = setup();
    client.enqueue({ text: 'urn []', durationMs: 42 });
    const token = new MockCancellationToken();

    assert.deepEqual(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(token)), []);
    token.cancel();
    await waitFor(() => client.requests.length === 1);
    assert.equal(client.signals[0].aborted, false);
    await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));

    const items = controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    assert.equal(inlineText(items), 'urn []');
    assert.equal(client.requests.length, 1);
    assert.equal(editor.document, document);
  });

  it('deduplicates provider calls while one request is scheduled or in flight', async () => {
    const { document, position, controller, client } = setup();
    client.enqueue(new Promise<InfillResult>(() => undefined));

    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.requests.length === 1);
    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));

    assert.equal(client.requests.length, 1);
  });

  it('offers only the visible buffer window and records a native visible acceptance', async () => {
    const { document, position, controller, client, metrics } = setup();
    client.enqueue({ text: 'one\ntwo\nthree', durationMs: 10 });

    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.requests.length === 1);
    await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));
    const items = controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    const item = items[0] as unknown as { insertText: string; command?: { arguments?: unknown[] } };

    assert.equal(item.insertText, 'one\ntwo');
    const offset = document.offsetAt(position);
    assert.deepEqual(item.command?.arguments, [1, offset, 'one\ntwo']);
    controller.recordVisibleAcceptance(1, offset, 'one\ntwo');
    assert.equal(metrics.snapshot().visibleAccepts, 1);
    assert.equal(metrics.snapshot().visibleAcceptedCharacters, 'one\ntwo'.length);
  });

  it('reuses a typed prefix and exposes only the next visible portion without another request', async () => {
    const { document, position, editor, controller, client } = setup();
    client.enqueue({ text: 'urn []', durationMs: 42 });
    await ready(controller, client, document, position);
    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));

    document.replaceText('def scan():\n    return');
    controller.onDocumentChanged(changeEvent(document, position, 'urn'));
    const nextPosition = new MockPosition(1, 10);
    moveMockEditor(editor, nextPosition);
    const items = controller.provide(asTextDocument(document), asPosition(nextPosition), manualContext(), asCancellationToken(new MockCancellationToken()));

    assert.equal(inlineText(items), ' []');
    assert.equal(client.requests.length, 1);
  });

  it('aborts a request on a relevant document change but ignores an unrelated document', async () => {
    const { document, position, controller, client } = setup();
    client.enqueue(new Promise<InfillResult>(() => undefined));
    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.signals.length === 1);

    const other = new MockTextDocument('x = 1', 'python', 'file:///other.py');
    controller.onDocumentChanged(changeEvent(other, new MockPosition(0, 0), 'x'));
    assert.equal(client.signals[0].aborted, false);
    document.replaceText('def scan():\n    retx');
    controller.onDocumentChanged(changeEvent(document, position, 'x'));

    assert.equal(client.signals[0].aborted, true);
  });

  it('invalidates the session when the active editor changes', async () => {
    const { document, position, controller, client } = setup();
    client.enqueue(new Promise<InfillResult>(() => undefined));
    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.signals.length === 1);

    const otherDocument = new MockTextDocument('x = 1', 'python', 'file:///other.py');
    const otherEditor = createMockEditor(otherDocument, new MockPosition(0, 0));
    vscodeMock.window.activeTextEditor = otherEditor;
    controller.onActiveEditorChanged(otherEditor as unknown as vscode.TextEditor);

    assert.equal(client.signals[0].aborted, true);
  });

  it('serializes partial acceptance commands', async () => {
    const { document, position, editor, controller, client, metrics } = setup();
    client.enqueue({ text: 'urn []', durationMs: 42 });
    await ready(controller, client, document, position);
    let editCalls = 0;
    editor.edit = async (callback) => {
      editCalls += 1;
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      callback({ insert: () => undefined });
      return true;
    };

    await Promise.all([controller.acceptNextWord(), controller.acceptNextWord()]);

    assert.equal(editCalls, 1);
    assert.equal(metrics.snapshot().wordAccepts, 1);
  });

  it('shows a live stream before it finishes and keeps the full continuation visible', async () => {
    const document = new MockTextDocument('def scan():\n');
    const position = new MockPosition(1, 0);
    const editor = createMockEditor(document, position);
    vscodeMock.window.activeTextEditor = editor;
    setConfiguration('justType.completionMode', 'live');
    const client = new StubInferenceClient();
    const metrics = new SessionMetrics();
    const controller = new CompletionSessionController(
      client,
      policy,
      'http://127.0.0.1:8012',
      metrics,
      new MockOutputChannel() as unknown as vscode.OutputChannel,
      new MockStatusBarItem() as unknown as vscode.StatusBarItem
    );
    let finish!: () => void;
    client.enqueueStream(async (onDelta) => {
      onDelta('first ');
      await new Promise<void>((resolve) => { finish = resolve; });
      onDelta(Array.from({ length: 120 }, (_, index) => `word${index}`).join(' '));
      return { text: '', durationMs: 10, stopReason: 'limit' };
    });

    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.streamRequests.length === 1);
    await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));
    assert.equal(inlineText(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()))), 'first ');
    assert.equal(client.streamRequests[0].nPredict, 512);
    assert.equal(client.streamRequests[0].serverPredictMs, 30_000);

    finish();
    await waitFor(() => inlineText(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()))).includes('word119'));
    const fullText = inlineText(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken())));
    assert.ok(fullText.split(/\s+/).length > 100);
    assert.equal(metrics.snapshot().suggestions, 1);
  });

  it('replaces an already visible live snapshot instead of adding it as an inline alternative', async () => {
    const document = new MockTextDocument('def scan():\n');
    const position = new MockPosition(1, 0);
    vscodeMock.window.activeTextEditor = createMockEditor(document, position);
    setConfiguration('justType.completionMode', 'live');
    const client = new StubInferenceClient();
    const controller = new CompletionSessionController(
      client,
      policy,
      'http://127.0.0.1:8012',
      new SessionMetrics(),
      new MockOutputChannel() as unknown as vscode.OutputChannel,
      new MockStatusBarItem() as unknown as vscode.StatusBarItem
    );
    let releaseSecondDelta!: () => void;
    let finish!: () => void;
    client.enqueueStream(async (onDelta) => {
      onDelta('first ');
      await new Promise<void>((resolve) => { releaseSecondDelta = resolve; });
      onDelta('second ');
      await new Promise<void>((resolve) => { finish = resolve; });
      return { text: '', durationMs: 10, stopReason: 'limit' };
    });

    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.streamRequests.length === 1);
    await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));
    assert.equal(inlineText(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()))), 'first ');
    vscodeMock.commands.executedCommands.length = 0;

    releaseSecondDelta();
    await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));
    assert.deepEqual(vscodeMock.commands.executedCommands, [
      'editor.action.inlineSuggest.hide',
      'editor.action.inlineSuggest.trigger'
    ]);
    assert.equal(inlineText(controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()))), 'first second ');

    finish();
  });

  it('cancels a live stream before its first token and suppresses an immediate automatic restart', async () => {
    const document = new MockTextDocument('def scan():\n');
    const position = new MockPosition(1, 0);
    vscodeMock.window.activeTextEditor = createMockEditor(document, position);
    setConfiguration('justType.completionMode', 'live');
    const client = new StubInferenceClient();
    const controller = new CompletionSessionController(
      client,
      policy,
      'http://127.0.0.1:8012',
      new SessionMetrics(),
      new MockOutputChannel() as unknown as vscode.OutputChannel,
      new MockStatusBarItem() as unknown as vscode.StatusBarItem
    );
    client.enqueueStream(async () => new Promise<StreamInfillResult>(() => undefined));

    controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
    await waitFor(() => client.streamSignals.length === 1);
    controller.dismiss();
    assert.equal(client.streamSignals[0].aborted, true);
    controller.provide(asTextDocument(document), asPosition(position), automaticContext(), asCancellationToken(new MockCancellationToken()));
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(client.streamRequests.length, 1);
  });
});

function setup(): {
  document: MockTextDocument;
  position: MockPosition;
  editor: ReturnType<typeof createMockEditor>;
  controller: InstanceType<typeof CompletionSessionController>;
  client: StubInferenceClient;
  metrics: SessionMetrics;
} {
  const document = new MockTextDocument('def scan():\n    ret');
  const position = new MockPosition(1, 7);
  const editor = createMockEditor(document, position);
  vscodeMock.window.activeTextEditor = editor;
  const client = new StubInferenceClient();
  const metrics = new SessionMetrics();
  const controller = new CompletionSessionController(
    client,
    policy,
    'http://127.0.0.1:8012',
    metrics,
    new MockOutputChannel() as unknown as vscode.OutputChannel,
    new MockStatusBarItem() as unknown as vscode.StatusBarItem
  );
  return { document, position, editor, controller, client, metrics };
}

async function ready(
  controller: InstanceType<typeof CompletionSessionController>,
  client: StubInferenceClient,
  document: MockTextDocument,
  position: MockPosition
): Promise<void> {
  controller.provide(asTextDocument(document), asPosition(position), manualContext(), asCancellationToken(new MockCancellationToken()));
  await waitFor(() => client.requests.length === 1);
  await waitFor(() => vscodeMock.commands.executedCommands.includes('editor.action.inlineSuggest.trigger'));
}

function manualContext(): vscode.InlineCompletionContext {
  return { triggerKind: vscodeMock.InlineCompletionTriggerKind.Invoke } as unknown as vscode.InlineCompletionContext;
}

function automaticContext(): vscode.InlineCompletionContext {
  return { triggerKind: vscodeMock.InlineCompletionTriggerKind.Automatic } as unknown as vscode.InlineCompletionContext;
}

function changeEvent(document: MockTextDocument, position: MockPosition, text: string): vscode.TextDocumentChangeEvent {
  return {
    document: asTextDocument(document),
    contentChanges: [{ rangeOffset: document.offsetAt(position), rangeLength: 0, text }]
  } as unknown as vscode.TextDocumentChangeEvent;
}

function inlineText(items: vscode.InlineCompletionItem[]): string {
  return (items[0] as unknown as { insertText?: string } | undefined)?.insertText ?? '';
}

async function waitFor(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise<void>((resolve) => setTimeout(resolve, 1));
  assert.ok(condition(), 'Timed out waiting for condition');
}
