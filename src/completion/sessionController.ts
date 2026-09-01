import * as vscode from 'vscode';
import { hash } from '../core/hash';
import { LruCache } from '../core/lruCache';
import { SessionMetrics } from '../core/metrics';
import type { CompletionPolicy, InfillResult, RequestStamp } from '../core/types';
import type { InferenceClient } from '../inference/llamaCppClient';
import { buildCompletionContext, type CompletionContext } from './contextBuilder';
import { PredictionBuffer, type TextEditSummary } from './predictionBuffer';

type Session = {
  epoch: number;
  buffer?: PredictionBuffer;
  inFlight?: AbortController;
  inFlightStamp?: RequestStamp;
  unavailableUntil: number;
};

export class CompletionSessionController {
  private readonly session: Session = { epoch: 0, unavailableUntil: 0 };
  private readonly cache: LruCache<string>;
  private latestEditAt = 0;
  private nextDebounceMs: number;

  public constructor(
    private readonly client: InferenceClient,
    private readonly policy: CompletionPolicy,
    private endpoint: string,
    private readonly metrics: SessionMetrics,
    private readonly log: vscode.OutputChannel,
    private readonly status: vscode.StatusBarItem
  ) {
    this.cache = new LruCache<string>(policy.cacheCapacity, policy.cacheTtlMs);
    this.nextDebounceMs = policy.debounceMs;
  }

  public async provide(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!this.isEnabled() || document.languageId !== 'python' || !this.isSingleCursor(document, position)) return [];
    const rightHash = hash(document.getText().slice(document.offsetAt(position), document.offsetAt(position) + this.policy.suffixChars));
    const existing = this.session.buffer;
    if (existing && existing.origin.uri === document.uri.toString() && existing.expectedOffset() === document.offsetAt(position) && existing.origin.rightContextHash === rightHash && !existing.isEmpty()) {
      return this.asInlineItems(existing.visibleText(this.policy.maxVisibleLines), position);
    }

    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && this.triggerMode() === 'manual') return [];
    if (Date.now() < this.session.unavailableUntil) return [];
    const delay = this.debounceDelay(context);
    if (delay > 0) await wait(delay, token);
    if (token.isCancellationRequested) return [];
    return this.request(document, position, token);
  }

  public onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    this.latestEditAt = Date.now();
    this.nextDebounceMs = isStructuralChange(event) ? this.policy.structuralDebounceMs : this.policy.debounceMs;
    const buffer = this.session.buffer;
    if (!buffer) {
      if (this.session.inFlight) this.invalidate('document changed while requesting');
      return;
    }
    if (event.document.uri.toString() !== buffer.origin.uri) {
      this.invalidate('document changed outside the active prediction');
      return;
    }
    const change = event.contentChanges.length === 1 ? event.contentChanges[0] : undefined;
    if (!change) {
      this.invalidate('multiple edits');
      return;
    }
    // Text-document events can arrive before the active editor publishes its new
    // selection. Derive the post-edit cursor from the change itself so a typed
    // prefix is not mistaken for a deviation during that small event-order gap.
    const cursorOffsetAfterChange = change.rangeOffset + change.text.length;
    const rightText = event.document.getText().slice(cursorOffsetAfterChange, cursorOffsetAfterChange + this.policy.suffixChars);
    const edit: TextEditSummary = {
      uri: event.document.uri.toString(),
      rangeOffset: change.rangeOffset,
      rangeLength: change.rangeLength,
      text: change.text,
      rightContextHash: hash(rightText)
    };
    const result = buffer.consume(edit);
    if (result === 'matched') {
      this.metrics.addReusedCharacters(change.text.length);
      if (buffer.isEmpty()) this.session.buffer = undefined;
      return;
    }
    this.invalidate(result);
  }

  public onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (event.textEditor.selections.length !== 1) {
      this.invalidate('multiple selections');
      return;
    }
    const offset = event.textEditor.document.offsetAt(event.selections[0].active);
    const buffer = this.session.buffer;
    const request = this.session.inFlightStamp;
    if ((buffer && (buffer.origin.uri !== event.textEditor.document.uri.toString() || buffer.expectedOffset() !== offset)) || (request && (request.uri !== event.textEditor.document.uri.toString() || request.cursorOffset !== offset))) {
      this.invalidate('cursor moved');
    }
  }

  public async acceptNextWord(): Promise<void> {
    const text = this.session.buffer?.nextWord() ?? '';
    if (!text) return;
    await this.insertActive(text, 'wordAccepts');
  }

  public async acceptNextLine(): Promise<void> {
    const text = this.session.buffer?.nextLine() ?? '';
    if (!text) return;
    await this.insertActive(text, 'lineAccepts');
  }

  public dismiss(): void {
    this.invalidate('dismissed by user');
  }

  public async checkConnection(): Promise<void> {
    this.status.text = '$(sync~spin) JustType: checking';
    const health = await this.client.health(AbortSignal.timeout(2_000));
    this.status.text = health.ok ? '$(sparkle) JustType: ready' : '$(plug) JustType: offline';
    this.log.appendLine(`Connection check: ${health.detail}`);
  }

  public clearCache(): void {
    this.cache.clear();
    this.invalidate('cache cleared');
  }

  public updateEndpoint(endpoint: string): void {
    this.endpoint = endpoint;
    this.clearCache();
  }

  private async request(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.InlineCompletionItem[]> {
    this.abortInFlight();
    const context = buildCompletionContext(document, position, ++this.session.epoch, this.policy, this.endpoint);
    const cached = this.cache.get(context.cacheKey);
    if (cached) {
      this.metrics.increment('cacheHits');
      this.session.buffer = new PredictionBuffer(context.stamp, cached);
      return this.asInlineItems(this.session.buffer.visibleText(this.policy.maxVisibleLines), position);
    }
    const controller = new AbortController();
    this.session.inFlight = controller;
    this.session.inFlightStamp = context.stamp;
    const disposable = token.onCancellationRequested(() => controller.abort());
    this.metrics.increment('requests');
    this.status.text = '$(sync~spin) JustType: thinking';
    try {
      const result = await this.client.infill({
        inputPrefix: context.inputPrefix,
        prompt: context.prompt,
        inputSuffix: context.inputSuffix,
        nPredict: this.policy.nPredict,
        timeoutMs: this.policy.requestTimeoutMs
      }, controller.signal);
      if (!this.isCurrent(context.stamp, document, position)) {
        this.metrics.increment('staleResponses');
        return [];
      }
      return this.acceptResult(context, result, position);
    } catch (error) {
      if (controller.signal.aborted) this.metrics.increment('aborts');
      else {
        this.metrics.increment('errors');
        this.session.unavailableUntil = Date.now() + 5_000;
        this.log.appendLine(`Completion request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return [];
    } finally {
      disposable.dispose();
      if (this.session.inFlight === controller) {
        this.session.inFlight = undefined;
        this.session.inFlightStamp = undefined;
      }
      this.status.text = '$(sparkle) JustType: ready';
    }
  }

  private acceptResult(context: CompletionContext, result: InfillResult, position: vscode.Position): vscode.InlineCompletionItem[] {
    const text = normalizeCompletion(result.text, context.inputSuffix);
    if (!text) return [];
    this.metrics.recordLatency(result.durationMs);
    this.metrics.increment('suggestions');
    this.cache.set(context.cacheKey, text);
    this.session.buffer = new PredictionBuffer(context.stamp, text);
    return this.asInlineItems(this.session.buffer.visibleText(this.policy.maxVisibleLines), position);
  }

  private isCurrent(stamp: RequestStamp, document: vscode.TextDocument, position: vscode.Position): boolean {
    const active = vscode.window.activeTextEditor;
    return this.session.epoch === stamp.epoch && document.version === stamp.documentVersion && document.uri.toString() === stamp.uri && document.offsetAt(position) === stamp.cursorOffset && active?.document.uri.toString() === document.uri.toString() && active.selections.length === 1 && active.selection.active.isEqual(position) && hash(document.getText().slice(stamp.cursorOffset, stamp.cursorOffset + this.policy.suffixChars)) === stamp.rightContextHash;
  }

  private asInlineItems(text: string, position: vscode.Position): vscode.InlineCompletionItem[] {
    return text ? [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))] : [];
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('justType').get<boolean>('enabled', true);
  }

  private triggerMode(): 'automatic' | 'manual' {
    return vscode.workspace.getConfiguration('justType').get<'automatic' | 'manual'>('triggerMode', 'automatic');
  }

  private isSingleCursor(document: vscode.TextDocument, position: vscode.Position): boolean {
    const active = vscode.window.activeTextEditor;
    return active?.document === document && active.selections.length === 1 && active.selection.active.isEqual(position);
  }

  private debounceDelay(context: vscode.InlineCompletionContext): number {
    if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Automatic) return 0;
    const elapsed = Date.now() - this.latestEditAt;
    const delay = this.nextDebounceMs - elapsed;
    return Math.max(0, delay);
  }

  private async insertActive(text: string, metric: 'wordAccepts' | 'lineAccepts'): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selections.length !== 1) return;
    const success = await editor.edit((builder) => builder.insert(editor.selection.active, text));
    if (success) this.metrics.increment(metric);
  }

  private invalidate(reason: string): void {
    this.session.epoch += 1;
    this.session.buffer = undefined;
    this.abortInFlight();
    this.log.appendLine(`Prediction invalidated: ${reason}`);
  }

  private abortInFlight(): void {
    if (this.session.inFlight) this.session.inFlight.abort();
  }
}

function isStructuralChange(event: vscode.TextDocumentChangeEvent): boolean {
  return event.contentChanges.some((change) => change.rangeLength > 0 || change.text.length > 1 || change.text.includes('\n'));
}

function normalizeCompletion(text: string, suffix: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '';
  if (suffix.length > 0) return normalized.split('\n')[0] ?? '';
  return normalized;
}

async function wait(delay: number, token: vscode.CancellationToken): Promise<void> {
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, delay);
    token.onCancellationRequested(() => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
