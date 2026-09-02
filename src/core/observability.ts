export type LogValue = string | number | boolean | undefined;

export type LogSink = {
  appendLine(value: string): void;
};

/**
 * Emits a compact JSON line suitable for VS Code's Output channel.
 * Callers must pass aggregate metadata only: never prompt, completion,
 * document path, or source text.
 */
export function logEvent(sink: LogSink, event: string, fields: Record<string, LogValue> = {}): void {
  sink.appendLine(formatLogEvent(event, fields));
}

export function formatLogEvent(event: string, fields: Record<string, LogValue> = {}): string {
  const definedFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  return JSON.stringify({ at: new Date().toISOString(), event, ...definedFields });
}
