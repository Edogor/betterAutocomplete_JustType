import * as vscode from 'vscode';
import { DEFAULT_POLICY } from './core/types';
import { SessionMetrics } from './core/metrics';
import { logEvent } from './core/observability';
import { CompletionSessionController } from './completion/sessionController';
import { LlamaCppClient } from './inference/llamaCppClient';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('JustType');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(sparkle) JustType: ready';
  status.command = 'justType.checkConnection';
  status.show();
  const metrics = new SessionMetrics();
  const endpoint = vscode.workspace.getConfiguration('justType').get<string>('llamaCpp.endpoint', 'http://127.0.0.1:8012');
  const client = new LlamaCppClient(endpoint);
  const controller = new CompletionSessionController(
    client,
    DEFAULT_POLICY,
    endpoint,
    metrics,
    log,
    status
  );

  const provider: vscode.InlineCompletionItemProvider = {
    provideInlineCompletionItems: (document, position, completionContext, token) => controller.provide(document, position, completionContext, token)
  };

  context.subscriptions.push(
    log,
    status,
    vscode.languages.registerInlineCompletionItemProvider({ language: 'python' }, provider),
    vscode.workspace.onDidChangeTextDocument((event) => controller.onDocumentChanged(event)),
    vscode.window.onDidChangeTextEditorSelection((event) => controller.onSelectionChanged(event)),
    vscode.window.onDidChangeActiveTextEditor((editor) => controller.onActiveEditorChanged(editor)),
    vscode.workspace.onDidCloseTextDocument((document) => controller.onDocumentClosed(document)),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('justType.llamaCpp.endpoint')) {
        const updatedEndpoint = vscode.workspace.getConfiguration('justType').get<string>('llamaCpp.endpoint', 'http://127.0.0.1:8012');
        client.setEndpoint(updatedEndpoint);
        controller.updateEndpoint(updatedEndpoint);
      } else if (event.affectsConfiguration('justType')) {
        controller.clearCache();
        const enabled = vscode.workspace.getConfiguration('justType').get<boolean>('enabled', true);
        const mode = vscode.workspace.getConfiguration('justType').get<'standard' | 'live'>('completionMode', 'standard');
        status.text = enabled ? `$(sparkle) JustType: ${mode === 'live' ? 'live' : 'ready'}` : '$(circle-slash) JustType: disabled';
      }
    }),
    vscode.commands.registerCommand('justType.toggle', async () => {
      const settings = vscode.workspace.getConfiguration('justType');
      const enabled = settings.get<boolean>('enabled', true);
      await settings.update('enabled', !enabled, vscode.ConfigurationTarget.Global);
      status.text = enabled ? '$(circle-slash) JustType: disabled' : '$(sparkle) JustType: ready';
    }),
    vscode.commands.registerCommand('justType.toggleLiveMode', async () => {
      const settings = vscode.workspace.getConfiguration('justType');
      const mode = settings.get<'standard' | 'live'>('completionMode', 'standard');
      await settings.update('completionMode', mode === 'live' ? 'standard' : 'live', vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand('justType.trigger', () => vscode.commands.executeCommand('editor.action.inlineSuggest.trigger')),
    vscode.commands.registerCommand('justType.acceptNextWord', () => controller.acceptNextWord()),
    vscode.commands.registerCommand('justType.acceptNextLine', () => controller.acceptNextLine()),
    vscode.commands.registerCommand('justType.dismiss', () => controller.dismiss()),
    vscode.commands.registerCommand('justType.recordVisibleAcceptance', (epoch: number, offset: number, text: string) => controller.recordVisibleAcceptance(epoch, offset, text)),
    vscode.commands.registerCommand('justType.checkConnection', () => controller.checkConnection()),
    vscode.commands.registerCommand('justType.showMetrics', () => {
      const snapshot = metrics.snapshot();
      logEvent(log, 'session.metrics', snapshot);
      log.show(true);
      return snapshot;
    }),
    vscode.commands.registerCommand('justType.resetMetrics', () => metrics.reset()),
    vscode.commands.registerCommand('justType.openLog', () => log.show(true)),
    { dispose: () => controller.dispose() }
  );

  logEvent(log, 'extension.activated');
}

export function deactivate(): void {
  // All requests are owned by the controller and are disposed with the extension host.
}
