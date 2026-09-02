import type { RequestStamp } from '../core/types';

export type TextEditSummary = {
  uri: string;
  rangeOffset: number;
  rangeLength: number;
  text: string;
  rightContextHash: string;
};

export type ConsumeResult = 'matched' | 'mismatch' | 'invalid';

export class PredictionBuffer {
  private consumed = 0;
  private streamOpen = false;
  private readonly unbounded: boolean;

  public constructor(public readonly origin: RequestStamp, private text: string, streamOpen = false) {
    this.streamOpen = streamOpen;
    this.unbounded = streamOpen;
  }

  public remaining(): string {
    return this.text.slice(this.consumed);
  }

  public fullText(): string {
    return this.text;
  }

  public append(text: string): void {
    this.text += text;
  }

  public finishStream(): void {
    this.streamOpen = false;
  }

  public isStreamOpen(): boolean {
    return this.streamOpen;
  }

  public isUnbounded(): boolean {
    return this.unbounded;
  }

  public expectedOffset(): number {
    return this.origin.cursorOffset + this.consumed;
  }

  public visibleText(maxLines?: number): string {
    const remaining = this.remaining();
    if (maxLines === undefined) return remaining;
    const lines = remaining.split(/\r?\n/);
    return lines.slice(0, maxLines).join('\n');
  }

  public consume(edit: TextEditSummary): ConsumeResult {
    if (edit.uri !== this.origin.uri || edit.rangeLength !== 0 || edit.rightContextHash !== this.origin.rightContextHash) return 'invalid';
    if (edit.rangeOffset !== this.expectedOffset()) return 'invalid';
    if (!edit.text || !this.remaining().startsWith(edit.text)) return 'mismatch';
    this.consumed += edit.text.length;
    return 'matched';
  }

  public isEmpty(): boolean {
    return this.remaining().length === 0;
  }

  public nextWord(): string {
    const remaining = this.remaining();
    if (remaining.startsWith('\n')) return '\n';
    const match = remaining.match(/^([ \t]*)([A-Za-z_$][\w$]*|[^\s])/u);
    return match ? match[0] : '';
  }

  public nextLine(): string {
    const remaining = this.remaining();
    if (!remaining.startsWith('\n')) {
      const index = remaining.indexOf('\n');
      return index === -1 ? remaining : remaining.slice(0, index + 1);
    }
    const index = remaining.indexOf('\n', 1);
    return index === -1 ? remaining : remaining.slice(0, index + 1);
  }
}
