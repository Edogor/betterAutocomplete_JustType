import type * as vscode from 'vscode';
import { createRequire } from 'node:module';

type CjsLoader = {
  _load(request: string, parent: NodeModule | null | undefined, isMain: boolean): unknown;
};

type MockSelection = { active: MockPosition };

export class MockPosition {
  public constructor(public readonly line: number, public readonly character: number) {}

  public isEqual(other: { line: number; character: number }): boolean {
    return this.line === other.line && this.character === other.character;
  }
}

export class MockRange {
  public constructor(public readonly start: MockPosition, public readonly end: MockPosition) {}
}

export class MockInlineCompletionItem {
  public constructor(public readonly insertText: string, public readonly range: MockRange) {}
}

export class MockTextDocument {
  public version = 1;
  public readonly uri: { toString(): string };

  public constructor(
    private text: string,
    public readonly languageId = 'python',
    uri = 'file:///test.py'
  ) {
    this.uri = { toString: () => uri };
  }

  public getText(): string {
    return this.text;
  }

  public offsetAt(position: { line: number; character: number }): number {
    const lines = this.text.split('\n');
    const leadingLength = lines.slice(0, position.line).reduce((total, line) => total + line.length + 1, 0);
    return leadingLength + position.character;
  }

  public positionAt(offset: number): MockPosition {
    const leadingText = this.text.slice(0, offset);
    const line = leadingText.split('\n');
    return new MockPosition(line.length - 1, line.at(-1)?.length ?? 0);
  }

  public replaceText(text: string): void {
    this.text = text;
    this.version += 1;
  }
}

export type MockTextEditor = {
  document: MockTextDocument;
  selections: MockSelection[];
  selection: MockSelection;
  edit(callback: (builder: { insert(position: MockPosition, text: string): void }) => void): Promise<boolean>;
};

export function createMockEditor(document: MockTextDocument, position: MockPosition): MockTextEditor {
  const selection = { active: position };
  return {
    document,
    selections: [selection],
    selection,
    async edit(callback): Promise<boolean> {
      callback({ insert: () => undefined });
      return true;
    }
  };
}

export function moveMockEditor(editor: MockTextEditor, position: MockPosition): void {
  const selection = { active: position };
  editor.selection = selection;
  editor.selections = [selection];
}

export class MockCancellationToken {
  public isCancellationRequested = false;
  private readonly listeners = new Set<() => void>();

  public onCancellationRequested(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public cancel(): void {
    this.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }
}

export class MockOutputChannel {
  public readonly lines: string[] = [];

  public appendLine(value: string): void {
    this.lines.push(value);
  }
}

export class MockStatusBarItem {
  public text = '';
}

const settings = new Map<string, unknown>();
let activeTextEditor: unknown;
const executedCommands: string[] = [];

export const vscodeMock = {
  Position: MockPosition,
  Range: MockRange,
  InlineCompletionItem: MockInlineCompletionItem,
  InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
  workspace: {
    getConfiguration(section?: string) {
      return {
        get<T>(key: string, defaultValue?: T): T {
          const value = settings.get(`${section ?? ''}.${key}`);
          return (value === undefined ? defaultValue : value) as T;
        }
      };
    }
  },
  window: {
    get activeTextEditor(): unknown {
      return activeTextEditor;
    },
    set activeTextEditor(value: unknown) {
      activeTextEditor = value;
    }
  },
  commands: {
    executedCommands,
    async executeCommand(command: string): Promise<void> {
      executedCommands.push(command);
    }
  }
};

const localRequire = createRequire(__filename);
const moduleLoader = localRequire('node:module') as CjsLoader;
const originalLoad = moduleLoader._load.bind(moduleLoader);
let installed = false;

export function installVscodeMock(): void {
  if (installed) return;
  moduleLoader._load = (request, parent, isMain) => request === 'vscode'
    ? vscodeMock
    : originalLoad(request, parent, isMain);
  installed = true;
}

export function resetVscodeMock(): void {
  settings.clear();
  activeTextEditor = undefined;
  executedCommands.length = 0;
}

export function setConfiguration(key: string, value: unknown): void {
  settings.set(key, value);
}

export function asTextDocument(document: MockTextDocument): vscode.TextDocument {
  return document as unknown as vscode.TextDocument;
}

export function asTextEditor(editor: MockTextEditor): vscode.TextEditor {
  return editor as unknown as vscode.TextEditor;
}

export function asPosition(position: MockPosition): vscode.Position {
  return position as unknown as vscode.Position;
}

export function asCancellationToken(token: MockCancellationToken): vscode.CancellationToken {
  return token as unknown as vscode.CancellationToken;
}

export function loadContextBuilder(): typeof import('../../src/completion/contextBuilder') {
  installVscodeMock();
  return localRequire('../../src/completion/contextBuilder') as typeof import('../../src/completion/contextBuilder');
}

export function loadSessionController(): typeof import('../../src/completion/sessionController') {
  installVscodeMock();
  return localRequire('../../src/completion/sessionController') as typeof import('../../src/completion/sessionController');
}
