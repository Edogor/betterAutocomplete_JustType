import * as vscode from 'vscode';
import { hash } from '../core/hash';
import type { CompletionPolicy, RequestStamp } from '../core/types';

export type CompletionContext = {
  stamp: RequestStamp;
  inputPrefix: string;
  prompt: string;
  inputSuffix: string;
  cacheKey: string;
};

export function buildCompletionContext(
  document: vscode.TextDocument,
  position: vscode.Position,
  epoch: number,
  policy: CompletionPolicy,
  endpoint: string
): CompletionContext {
  const fullText = document.getText();
  const cursorOffset = document.offsetAt(position);
  const lineStart = document.offsetAt(new vscode.Position(position.line, 0));
  const inputPrefix = wholeLineWindow(fullText.slice(0, lineStart), policy.prefixChars);
  const prompt = fullText.slice(lineStart, cursorOffset);
  const inputSuffix = fullText.slice(cursorOffset, cursorOffset + policy.suffixChars);
  const rightContextHash = hash(inputSuffix);
  const stamp: RequestStamp = {
    uri: document.uri.toString(),
    documentVersion: document.version,
    cursorOffset,
    rightContextHash,
    epoch
  };
  return {
    stamp,
    inputPrefix,
    prompt,
    inputSuffix,
    cacheKey: hash([document.languageId, endpoint, inputPrefix, prompt, inputSuffix].join('\u0000'))
  };
}

function wholeLineWindow(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const tentativeStart = text.length - maxChars;
  const newline = text.indexOf('\n', tentativeStart);
  return text.slice(newline === -1 ? tentativeStart : newline + 1);
}
