export type RequestStamp = {
  uri: string;
  documentVersion: number;
  cursorOffset: number;
  rightContextHash: string;
  epoch: number;
};

export type InfillRequest = {
  inputPrefix: string;
  prompt: string;
  inputSuffix: string;
  nPredict: number;
  timeoutMs: number;
};

export type InfillResult = {
  text: string;
  durationMs: number;
  promptTokens?: number;
  predictedTokens?: number;
  cachedTokens?: number;
};

export type HealthStatus = { ok: boolean; detail: string };

export type CompletionPolicy = {
  prefixChars: number;
  suffixChars: number;
  nPredict: number;
  requestTimeoutMs: number;
  serverPredictMs: number;
  debounceMs: number;
  structuralDebounceMs: number;
  maxVisibleLines: number;
  cacheCapacity: number;
  cacheTtlMs: number;
};

export const DEFAULT_POLICY: CompletionPolicy = {
  prefixChars: 12_000,
  suffixChars: 4_000,
  nPredict: 32,
  requestTimeoutMs: 2_500,
  serverPredictMs: 1_200,
  debounceMs: 120,
  structuralDebounceMs: 250,
  maxVisibleLines: 8,
  cacheCapacity: 32,
  cacheTtlMs: 5 * 60_000
};

export type MetricsSnapshot = {
  requests: number;
  aborts: number;
  staleResponses: number;
  cacheHits: number;
  reusedCharacters: number;
  suggestions: number;
  wordAccepts: number;
  lineAccepts: number;
  errors: number;
  p50LatencyMs: number;
  p90LatencyMs: number;
};
