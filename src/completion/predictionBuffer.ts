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

  public constructor(public readonly origin: RequestStamp, private readonly text: string) {}

  public remaining(): string {
    return this.text.slice(this.consumed);
  }

  public expectedOffset(): number {
    return this.origin.cursorOffset + this.consumed;
  }

  public visibleText(maxLines: number): string {
    const remaining = this.remaining();
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
    const match = remaining.match(/^(\s*)([A-Za-z_$][\w$]*|\S)/u);
    return match ? match[0] : '';
  }

  public nextLine(): string {
    const remaining = this.remaining();
    const index = remaining.indexOf('\n');
    return index === -1 ? remaining : remaining.slice(0, index + 1);
  }
}
