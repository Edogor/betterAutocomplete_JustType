import * as vscode from 'vscode';
import { hash } from '../core/hash';
import { LruCache } from '../core/lruCache';
import { SessionMetrics } from '../core/metrics';
import { logEvent } from '../core/observability';
import type { CompletionPolicy, InfillResult, RequestStamp, StreamInfillResult } from '../core/types';
import type { InferenceClient } from '../inference/llamaCppClient';
import { buildCompletionContext, type CompletionContext } from './contextBuilder';
import { PredictionBuffer, type TextEditSummary } from './predictionBuffer';

type CompletionMode = 'standard' | 'live';
type ScheduledRequest = { context: CompletionContext; document: vscode.TextDocument; mode: CompletionMode; cacheKey: string; startedAt: number; timer: ReturnType<typeof setTimeout> };
type NativeOffer = { epoch: number; offset: number; text: string; accepted: boolean };
type PendingCommandAcceptance = { uri: string; rangeOffset: number; text: string };
type PendingNativeEdit = { offer: NativeOffer; timer: ReturnType<typeof setTimeout> };
type Session = { epoch: number; buffer?: PredictionBuffer; suggestionOffered: boolean; suggestionCreated: boolean; scheduled?: ScheduledRequest; inFlight?: AbortController; inFlightStamp?: RequestStamp; inFlightMode?: CompletionMode; streamId?: number; unavailableUntil: number };

/** Owns the one active editor completion session. */
export class CompletionSessionController {
  private readonly session: Session = { epoch: 0, suggestionOffered: false, suggestionCreated: false, unavailableUntil: 0 };
  private readonly cache: LruCache<string>;
  private latestEditAt = 0;
  private nextDebounceMs: number;
  private pendingCommandAcceptance?: PendingCommandAcceptance;
  private pendingNativeEdit?: PendingNativeEdit;
  private lastOffer?: NativeOffer;
  private readonly offers = new Map<string, NativeOffer>();
  private accepting = false;
  private nextStreamId = 0;
  private liveRefreshTimer?: ReturnType<typeof setTimeout>;
  private lastLiveRefreshAt = 0;
  private dismissedKey?: string;

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

  public provide(document: vscode.TextDocument, position: vscode.Position, context: vscode.InlineCompletionContext, token: vscode.CancellationToken): vscode.InlineCompletionItem[] {
    void token;
    if (!this.isEnabled() || document.languageId !== 'python' || !this.isSingleCursor(document, position)) return [];
    const cursorOffset = document.offsetAt(position);
    const rightHash = this.rightHash(document, cursorOffset);
    const buffer = this.session.buffer;
    if (buffer && this.matchesBuffer(buffer, document, cursorOffset, rightHash)) return buffer.isEmpty() ? [] : this.presentBuffer(buffer, position);
    if (buffer) this.invalidate('active prediction no longer applies');
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && this.triggerMode() === 'manual') return [];
    if (context.triggerKind === vscode.InlineCompletionTriggerKind.Automatic && this.dismissedKey === this.positionKey(document, cursorOffset, rightHash)) return [];
    if (Date.now() < this.session.unavailableUntil || this.isMatchingScheduled(document, cursorOffset, rightHash) || this.isMatchingInFlight(document, cursorOffset, rightHash)) return [];

    const mode = this.completionMode(document, cursorOffset);
    const completionContext = buildCompletionContext(document, position, ++this.session.epoch, this.policy, this.endpoint);
    const cacheKey = this.cacheKey(completionContext, mode);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.metrics.increment('cacheHits');
      this.setBuffer(new PredictionBuffer(completionContext.stamp, cached));
      logEvent(this.log, 'completion.cache_hit', { epoch: completionContext.stamp.epoch, mode });
      this.triggerNativeRefresh();
      return [];
    }
    this.schedule(completionContext, document, mode, cacheKey, this.debounceDelay(context, mode));
    return [];
  }

  public onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    if (!this.isRelevantDocument(event.document)) return;
    this.dismissedKey = undefined;
    this.latestEditAt = Date.now();
    this.nextDebounceMs = isStructuralChange(event) ? this.policy.structuralDebounceMs : this.policy.debounceMs;
    const buffer = this.session.buffer;
    if (!buffer) return this.invalidate('document changed while requesting');
    const change = event.contentChanges.length === 1 ? event.contentChanges[0] : undefined;
    if (!change) return this.invalidate('multiple edits');
    const cursorOffsetAfterChange = change.rangeOffset + change.text.length;
    const edit: TextEditSummary = { uri: event.document.uri.toString(), rangeOffset: change.rangeOffset, rangeLength: change.rangeLength, text: change.text, rightContextHash: this.rightHash(event.document, cursorOffsetAfterChange) };
    const result = buffer.consume(edit);
    if (result !== 'matched') return this.invalidate(result);
    this.metrics.addReusedCharacters(change.text.length);
    if (this.isPendingCommandAcceptance(edit)) this.pendingCommandAcceptance = undefined;
    else this.deferNativeOrTypedAccounting(edit);
    this.setPredictionReady(false);
    if (buffer.isEmpty() && !buffer.isStreamOpen()) this.completeBuffer();
    else if (!buffer.isEmpty()) this.refreshForBuffer(buffer);
  }

  public onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    if (!this.isRelevantDocument(event.textEditor.document)) return;
    if (event.textEditor.selections.length !== 1) return this.invalidate('multiple selections');
    const offset = event.textEditor.document.offsetAt(event.textEditor.selections[0].active);
    const buffer = this.session.buffer;
    const request = this.session.inFlightStamp ?? this.session.scheduled?.context.stamp;
    const liveBufferOwnsCursor = Boolean(buffer?.isStreamOpen());
    if ((buffer && buffer.expectedOffset() !== offset) || (request && !liveBufferOwnsCursor && request.cursorOffset !== offset)) this.invalidate('cursor moved');
  }

  public onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (this.hasActiveSession() && editor?.document.uri.toString() !== this.activeSessionUri()) this.invalidate('active editor changed');
  }

  public onDocumentClosed(document: vscode.TextDocument): void {
    if (this.isRelevantDocument(document)) this.invalidate('active document closed');
  }

  public async acceptNextWord(): Promise<void> { const text = this.session.buffer?.nextWord() ?? ''; if (text) await this.insertActive(text, 'wordAccepts'); }
  public async acceptNextLine(): Promise<void> { const text = this.session.buffer?.nextLine() ?? ''; if (text) await this.insertActive(text, 'lineAccepts'); }

  public recordVisibleAcceptance(epoch: number, offset: number, text: string): void {
    const offer = this.offers.get(this.offerKey(epoch, offset, text));
    if (!offer || offer.accepted) return;
    offer.accepted = true;
    if (this.pendingNativeEdit?.offer === offer) { clearTimeout(this.pendingNativeEdit.timer); this.pendingNativeEdit = undefined; }
    this.metrics.recordVisibleAccept(text.length);
    logEvent(this.log, 'suggestion.visible_accepted', { epoch, characters: text.length });
  }

  public dismiss(): void {
    const active = vscode.window.activeTextEditor;
    if (active?.selections.length === 1) {
      const offset = active.document.offsetAt(active.selection.active);
      this.dismissedKey = this.positionKey(active.document, offset, this.rightHash(active.document, offset));
    }
    const hadSession = this.hasActiveSession();
    this.invalidate('dismissed by user', true);
    if (hadSession) this.triggerNativeRefresh();
  }

  public async checkConnection(): Promise<void> {
    this.status.text = '$(sync~spin) JustType: checking';
    const health = await this.client.health(AbortSignal.timeout(2_000));
    if (health.ok) this.session.unavailableUntil = 0;
    this.status.text = health.ok ? '$(sparkle) JustType: ready' : '$(plug) JustType: offline';
    logEvent(this.log, 'model.health', { ok: health.ok, detail: health.detail });
  }

  public clearCache(): void { this.cache.clear(); this.invalidate('cache cleared'); }
  public updateEndpoint(endpoint: string): void { this.endpoint = endpoint; this.session.unavailableUntil = 0; this.clearCache(); }
  public dispose(): void { this.invalidate('extension deactivated'); }

  private schedule(context: CompletionContext, document: vscode.TextDocument, mode: CompletionMode, cacheKey: string, delay: number): void {
    const scheduled: ScheduledRequest = { context, document, mode, cacheKey, startedAt: Date.now(), timer: setTimeout(() => void this.startRequest(scheduled), delay) };
    this.session.scheduled = scheduled;
    this.status.text = delay > 0 ? '$(clock) JustType: waiting' : `$(sync~spin) JustType: ${mode === 'live' ? 'streaming' : 'thinking'}`;
    logEvent(this.log, 'completion.scheduled', { epoch: context.stamp.epoch, delayMs: delay, mode });
  }

  private async startRequest(scheduled: ScheduledRequest): Promise<void> {
    if (this.session.scheduled !== scheduled) return;
    this.session.scheduled = undefined;
    const { context, document, mode } = scheduled;
    if (!this.isCurrent(context.stamp, document)) return;
    const controller = new AbortController();
    this.session.inFlight = controller;
    this.session.inFlightStamp = context.stamp;
    this.session.inFlightMode = mode;
    this.metrics.increment('requests');
    this.status.text = `$(sync~spin) JustType: ${mode === 'live' ? 'streaming' : 'thinking'}`;
    logEvent(this.log, 'completion.request_started', { epoch: context.stamp.epoch, mode });
    try {
      if (mode === 'live') await this.startLiveRequest(scheduled, controller);
      else this.finishStandardRequest(scheduled, await this.client.infill(this.requestFor(context, 'standard'), controller.signal));
    } catch (error) {
      this.handleRequestError(scheduled, controller, error);
    } finally {
      if (this.session.inFlight === controller) {
        this.session.inFlight = undefined;
        this.session.inFlightStamp = undefined;
        this.session.inFlightMode = undefined;
        this.session.streamId = undefined;
        this.setGenerationActive(false);
      }
    }
  }

  private async startLiveRequest(scheduled: ScheduledRequest, controller: AbortController): Promise<void> {
    const streamId = ++this.nextStreamId;
    this.session.streamId = streamId;
    this.cancelLiveRefresh();
    this.setBuffer(new PredictionBuffer(scheduled.context.stamp, '', true));
    this.setGenerationActive(true);
    const result = await this.client.streamInfill(this.requestFor(scheduled.context, 'live'), controller.signal, (delta) => this.acceptLiveDelta(scheduled, controller, streamId, delta));
    this.finishLiveRequest(scheduled, controller, streamId, result);
  }

  private acceptLiveDelta(scheduled: ScheduledRequest, controller: AbortController, streamId: number, delta: string): void {
    if (!delta || this.session.inFlight !== controller || this.session.streamId !== streamId) return;
    const buffer = this.session.buffer;
    if (!buffer || !buffer.isStreamOpen() || !this.matchesBuffer(buffer, scheduled.document, buffer.expectedOffset(), this.rightHash(scheduled.document, buffer.expectedOffset()))) return;
    buffer.append(delta.replace(/\r\n/g, '\n'));
    if (!buffer.fullText().trim()) return;
    if (!this.session.suggestionCreated) { this.metrics.increment('suggestions'); this.session.suggestionCreated = true; }
    this.queueLiveRefresh();
  }

  private finishStandardRequest(scheduled: ScheduledRequest, result: InfillResult): void {
    this.metrics.increment('responses');
    this.metrics.recordLatency(result.durationMs);
    if (!this.isCurrent(scheduled.context.stamp, scheduled.document)) {
      this.metrics.increment('staleResponses');
      return logEvent(this.log, 'completion.stale_response', { durationMs: result.durationMs, epoch: scheduled.context.stamp.epoch });
    }
    if (!this.acceptStandardResult(scheduled.context, scheduled.cacheKey, result)) { this.status.text = '$(circle-slash) JustType: no prediction'; return; }
    this.metrics.recordOfferLatency(Date.now() - scheduled.startedAt);
    this.triggerNativeRefresh();
  }

  private finishLiveRequest(scheduled: ScheduledRequest, controller: AbortController, streamId: number, result: StreamInfillResult): void {
    if (this.session.inFlight !== controller || this.session.streamId !== streamId) return;
    const buffer = this.session.buffer;
    if (!buffer || !buffer.isStreamOpen() || !this.matchesBuffer(buffer, scheduled.document, buffer.expectedOffset(), this.rightHash(scheduled.document, buffer.expectedOffset()))) { this.metrics.increment('staleResponses'); return; }
    buffer.finishStream();
    this.metrics.increment('responses');
    this.metrics.recordLatency(result.durationMs);
    const text = buffer.fullText();
    if (!text.trim()) { this.session.buffer = undefined; this.session.suggestionCreated = false; this.status.text = '$(circle-slash) JustType: no prediction'; return; }
    this.cache.set(scheduled.cacheKey, text);
    this.metrics.recordOfferLatency(Date.now() - scheduled.startedAt);
    logEvent(this.log, 'completion.stream_finished', { durationMs: result.durationMs, promptTokens: result.promptTokens, predictedTokens: result.predictedTokens, cachedTokens: result.cachedTokens, stopReason: result.stopReason });
    if (buffer.isEmpty()) this.completeBuffer(); else this.triggerNativeRefresh();
  }

  private handleRequestError(scheduled: ScheduledRequest, controller: AbortController, error: unknown): void {
    if (controller.signal.aborted) { this.metrics.increment('aborts'); logEvent(this.log, 'completion.aborted', { epoch: scheduled.context.stamp.epoch, mode: scheduled.mode }); return; }
    const buffer = this.session.buffer;
    const hasLivePartial = scheduled.mode === 'live' && buffer?.isStreamOpen() && Boolean(buffer.fullText().trim());
    if (hasLivePartial && buffer) {
      buffer.finishStream();
      this.metrics.increment('errors');
      this.status.text = '$(warning) JustType: stream interrupted';
      logEvent(this.log, 'completion.stream_interrupted', { epoch: scheduled.context.stamp.epoch, error: error instanceof Error ? error.name : 'unknown' });
      this.triggerNativeRefresh();
      return;
    }
    if (scheduled.mode === 'live' && buffer?.isStreamOpen()) {
      buffer.finishStream();
      this.session.buffer = undefined;
      this.session.suggestionCreated = false;
    }
    this.metrics.increment('errors');
    this.session.unavailableUntil = Date.now() + 5_000;
    logEvent(this.log, 'completion.error', { epoch: scheduled.context.stamp.epoch, error: error instanceof Error ? error.name : 'unknown' });
    this.status.text = error instanceof Error && error.name === 'TimeoutError' ? '$(clock) JustType: model timeout' : '$(warning) JustType: request failed';
  }

  private acceptStandardResult(context: CompletionContext, cacheKey: string, result: InfillResult): boolean {
    const text = normalizeCompletion(result.text, context.inputSuffix);
    if (!text) return false;
    this.cache.set(cacheKey, text);
    this.setBuffer(new PredictionBuffer(context.stamp, text));
    this.metrics.increment('suggestions');
    this.session.suggestionCreated = true;
    logEvent(this.log, 'completion.response', { durationMs: result.durationMs, promptTokens: result.promptTokens, predictedTokens: result.predictedTokens, cachedTokens: result.cachedTokens });
    return true;
  }

  private presentBuffer(buffer: PredictionBuffer, position: vscode.Position): vscode.InlineCompletionItem[] {
    const text = buffer.visibleText(buffer.isUnbounded() ? undefined : this.policy.maxVisibleLines);
    if (!text) return [];
    const offset = buffer.expectedOffset();
    if (!this.lastOffer || this.lastOffer.epoch !== buffer.origin.epoch || this.lastOffer.offset !== offset || this.lastOffer.text !== text) {
      this.lastOffer = { epoch: buffer.origin.epoch, offset, text, accepted: false };
      this.rememberOffer(this.lastOffer);
    }
    if (!this.session.suggestionOffered) {
      this.session.suggestionOffered = true;
      this.metrics.recordSuggestionOffer();
      logEvent(this.log, 'suggestion.offered', { epoch: buffer.origin.epoch, characters: text.length });
    }
    this.setPredictionReady(true);
    this.status.text = buffer.isStreamOpen() ? `$(sync~spin) JustType: streaming (${buffer.remaining().length} chars)` : `$(lightbulb) JustType: prediction ready (${buffer.remaining().length} chars)`;
    const item = new vscode.InlineCompletionItem(text, new vscode.Range(position, position));
    item.command = { command: 'justType.recordVisibleAcceptance', title: 'Record JustType visible acceptance', arguments: [buffer.origin.epoch, offset, text] };
    return [item];
  }

  private rememberOffer(offer: NativeOffer): void {
    this.offers.set(this.offerKey(offer.epoch, offer.offset, offer.text), offer);
    while (this.offers.size > 32) this.offers.delete(this.offers.keys().next().value as string);
  }

  private deferNativeOrTypedAccounting(edit: TextEditSummary): void {
    const offer = [...this.offers.values()].find((candidate) => !candidate.accepted && candidate.offset === edit.rangeOffset && candidate.text === edit.text);
    if (!offer) { this.metrics.addTypedCharacters(edit.text.length); return; }
    if (this.pendingNativeEdit) clearTimeout(this.pendingNativeEdit.timer);
    const pending: PendingNativeEdit = { offer, timer: setTimeout(() => { if (this.pendingNativeEdit !== pending) return; this.pendingNativeEdit = undefined; if (!offer.accepted) this.metrics.addTypedCharacters(edit.text.length); }, 0) };
    this.pendingNativeEdit = pending;
  }

  private completeBuffer(): void {
    const buffer = this.session.buffer;
    if (!buffer || buffer.isStreamOpen()) return;
    if (this.session.suggestionOffered) { this.metrics.recordInferredFullBufferConsume(); logEvent(this.log, 'suggestion.fully_consumed', { epoch: buffer.origin.epoch }); }
    this.session.buffer = undefined;
    this.session.suggestionOffered = false;
    this.session.suggestionCreated = false;
    this.setPredictionReady(false);
    this.status.text = '$(sparkle) JustType: ready';
  }

  private async insertActive(text: string, metric: 'wordAccepts' | 'lineAccepts'): Promise<void> {
    if (this.accepting) return;
    const editor = vscode.window.activeTextEditor;
    const buffer = this.session.buffer;
    if (!editor || editor.selections.length !== 1 || !buffer || buffer.isEmpty()) return;
    const position = editor.selection.active;
    const cursorOffset = editor.document.offsetAt(position);
    if (!this.matchesBuffer(buffer, editor.document, cursorOffset, this.rightHash(editor.document, cursorOffset))) return;
    this.accepting = true;
    const pending: PendingCommandAcceptance = { uri: buffer.origin.uri, rangeOffset: cursorOffset, text };
    this.pendingCommandAcceptance = pending;
    try {
      const success = await editor.edit((builder) => builder.insert(position, text));
      if (success) { this.metrics.increment(metric); this.metrics.addCommandAcceptedCharacters(text.length); }
      else if (this.pendingCommandAcceptance === pending) this.pendingCommandAcceptance = undefined;
    } finally { this.accepting = false; }
  }

  private invalidate(reason: string, explicitDismissal = false): void {
    this.session.epoch += 1;
    const buffer = this.session.buffer;
    if (buffer && this.session.suggestionOffered && !buffer.isEmpty()) { this.metrics.recordAbandonedSuggestion(explicitDismissal); logEvent(this.log, 'suggestion.abandoned', { reason, epoch: buffer.origin.epoch, explicitDismissal }); }
    this.session.buffer = undefined;
    this.session.suggestionOffered = false;
    this.session.suggestionCreated = false;
    this.pendingCommandAcceptance = undefined;
    if (this.pendingNativeEdit) clearTimeout(this.pendingNativeEdit.timer);
    this.pendingNativeEdit = undefined;
    this.lastOffer = undefined;
    this.offers.clear();
    this.cancelLiveRefresh();
    this.cancelScheduled();
    this.abortInFlight();
    this.setPredictionReady(false);
    this.setGenerationActive(false);
    if (this.isEnabled()) this.status.text = '$(sparkle) JustType: ready';
    logEvent(this.log, 'prediction.invalidated', { reason, epoch: this.session.epoch });
  }

  private cancelScheduled(): void { const scheduled = this.session.scheduled; if (!scheduled) return; clearTimeout(scheduled.timer); this.session.scheduled = undefined; }
  private abortInFlight(): void { const controller = this.session.inFlight; this.session.inFlight = undefined; this.session.inFlightStamp = undefined; this.session.inFlightMode = undefined; this.session.streamId = undefined; controller?.abort(); }
  private setBuffer(buffer: PredictionBuffer): void { this.session.buffer = buffer; this.session.suggestionOffered = false; this.session.suggestionCreated = false; this.lastOffer = undefined; this.offers.clear(); }

  private requestFor(context: CompletionContext, mode: CompletionMode) {
    return { inputPrefix: context.inputPrefix, prompt: context.prompt, inputSuffix: context.inputSuffix, nPredict: mode === 'live' ? this.policy.liveNPredict : this.policy.nPredict, timeoutMs: mode === 'live' ? this.policy.liveRequestTimeoutMs : this.policy.requestTimeoutMs, serverPredictMs: mode === 'live' ? this.policy.liveServerPredictMs : this.policy.serverPredictMs };
  }

  private cacheKey(context: CompletionContext, mode: CompletionMode): string { return hash(`${context.cacheKey}\u0000${mode}`); }
  private offerKey(epoch: number, offset: number, text: string): string { return `${epoch}:${offset}:${text}`; }
  private isCurrent(stamp: RequestStamp, document: vscode.TextDocument): boolean {
    const active = vscode.window.activeTextEditor;
    if (!active || active.document.uri.toString() !== stamp.uri || active.selections.length !== 1) return false;
    const cursorOffset = document.offsetAt(active.selection.active);
    return this.session.epoch === stamp.epoch && document.version === stamp.documentVersion && cursorOffset === stamp.cursorOffset && this.rightHash(document, cursorOffset) === stamp.rightContextHash;
  }
  private matchesBuffer(buffer: PredictionBuffer, document: vscode.TextDocument, cursorOffset: number, rightHash: string): boolean { return buffer.origin.uri === document.uri.toString() && buffer.expectedOffset() === cursorOffset && buffer.origin.rightContextHash === rightHash && (!buffer.isEmpty() || buffer.isStreamOpen()); }
  private isMatchingScheduled(document: vscode.TextDocument, cursorOffset: number, rightHash: string): boolean {
    const stamp = this.session.scheduled?.context.stamp;
    return Boolean(stamp && stamp.uri === document.uri.toString() && stamp.documentVersion === document.version && stamp.cursorOffset === cursorOffset && stamp.rightContextHash === rightHash);
  }
  private isMatchingInFlight(document: vscode.TextDocument, cursorOffset: number, rightHash: string): boolean {
    const stamp = this.session.inFlightStamp;
    const live = this.session.inFlightMode === 'live';
    const buffer = this.session.buffer;
    return Boolean(stamp && stamp.uri === document.uri.toString() && (live ? buffer && this.matchesBuffer(buffer, document, cursorOffset, rightHash) : stamp.documentVersion === document.version && stamp.cursorOffset === cursorOffset && stamp.rightContextHash === rightHash) && !this.session.inFlight?.signal.aborted);
  }
  private isRelevantDocument(document: vscode.TextDocument): boolean { return this.activeSessionUri() === document.uri.toString(); }
  private activeSessionUri(): string | undefined { return this.session.buffer?.origin.uri ?? this.session.inFlightStamp?.uri ?? this.session.scheduled?.context.stamp.uri; }
  private hasActiveSession(): boolean { return Boolean(this.session.buffer || this.session.inFlight || this.session.scheduled); }
  private rightHash(document: vscode.TextDocument, offset: number): string { return hash(document.getText().slice(offset, offset + this.policy.suffixChars)); }
  private positionKey(document: vscode.TextDocument, offset: number, rightHash: string): string { return `${document.uri.toString()}:${document.version}:${offset}:${rightHash}`; }
  private isPendingCommandAcceptance(edit: TextEditSummary): boolean { const pending = this.pendingCommandAcceptance; return Boolean(pending && pending.uri === edit.uri && pending.rangeOffset === edit.rangeOffset && pending.text === edit.text); }
  private isEnabled(): boolean { return vscode.workspace.getConfiguration('justType').get<boolean>('enabled', true); }
  private triggerMode(): 'automatic' | 'manual' { return vscode.workspace.getConfiguration('justType').get<'automatic' | 'manual'>('triggerMode', 'automatic'); }
  private completionMode(document: vscode.TextDocument, cursorOffset: number): CompletionMode { return vscode.workspace.getConfiguration('justType').get<CompletionMode>('completionMode', 'standard') === 'live' && this.isAtLineEnd(document, cursorOffset) ? 'live' : 'standard'; }
  private isAtLineEnd(document: vscode.TextDocument, cursorOffset: number): boolean { const next = document.getText().charAt(cursorOffset); return next === '' || next === '\n' || next === '\r'; }
  private isSingleCursor(document: vscode.TextDocument, position: vscode.Position): boolean { const active = vscode.window.activeTextEditor; return active?.document === document && active.selections.length === 1 && active.selection.active.isEqual(position); }
  private debounceDelay(context: vscode.InlineCompletionContext, mode: CompletionMode): number { if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Automatic) return 0; const debounce = mode === 'live' ? this.policy.liveDebounceMs : this.nextDebounceMs; return Math.max(0, debounce - (Date.now() - this.latestEditAt)); }
  private refreshForBuffer(buffer: PredictionBuffer): void { if (buffer.isStreamOpen()) this.queueLiveRefresh(); else this.triggerNativeRefresh(); }
  private queueLiveRefresh(): void {
    const elapsed = Date.now() - this.lastLiveRefreshAt;
    if (this.lastLiveRefreshAt === 0 || elapsed >= this.policy.liveRefreshMs) { this.lastLiveRefreshAt = Date.now(); this.triggerNativeRefresh(); return; }
    if (this.liveRefreshTimer) return;
    this.liveRefreshTimer = setTimeout(() => { this.liveRefreshTimer = undefined; this.lastLiveRefreshAt = Date.now(); this.triggerNativeRefresh(); }, this.policy.liveRefreshMs - elapsed);
  }
  private cancelLiveRefresh(): void { if (this.liveRefreshTimer) clearTimeout(this.liveRefreshTimer); this.liveRefreshTimer = undefined; this.lastLiveRefreshAt = 0; }
  private setPredictionReady(value: boolean): void { void vscode.commands.executeCommand('setContext', 'justType.predictionReady', value); }
  private setGenerationActive(value: boolean): void { void vscode.commands.executeCommand('setContext', 'justType.generationActive', value); }
  private triggerNativeRefresh(): void { queueMicrotask(() => void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')); }
}

function isStructuralChange(event: vscode.TextDocumentChangeEvent): boolean { return event.contentChanges.some((change) => change.rangeLength > 0 || change.text.length > 1 || change.text.includes('\n')); }
function normalizeCompletion(text: string, suffix: string): string { const normalized = text.replace(/\r\n/g, '\n'); if (!normalized.trim()) return ''; return suffix.length > 0 ? normalized.split('\n')[0] ?? '' : normalized; }
