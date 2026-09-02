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
  serverPredictMs: number;
};

export type InfillResult = {
  text: string;
  durationMs: number;
  promptTokens?: number;
  predictedTokens?: number;
  cachedTokens?: number;
};

export type InfillStopReason = 'eos' | 'limit' | 'word' | 'unknown';

export type StreamInfillResult = InfillResult & {
  stopReason: InfillStopReason;
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
  liveNPredict: number;
  liveRequestTimeoutMs: number;
  liveServerPredictMs: number;
  liveDebounceMs: number;
  liveRefreshMs: number;
};

export const DEFAULT_POLICY: CompletionPolicy = {
  prefixChars: 12_000,
  suffixChars: 4_000,
  nPredict: 32,
  requestTimeoutMs: 8_000,
  serverPredictMs: 3_000,
  debounceMs: 400,
  structuralDebounceMs: 650,
  maxVisibleLines: 8,
  cacheCapacity: 32,
  cacheTtlMs: 5 * 60_000,
  liveNPredict: 512,
  liveRequestTimeoutMs: 45_000,
  liveServerPredictMs: 30_000,
  liveDebounceMs: 100,
  liveRefreshMs: 50
};

export type MetricsSnapshot = {
  requests: number;
  responses: number;
  aborts: number;
  staleResponses: number;
  cacheHits: number;
  reusedCharacters: number;
  /** Exact active-buffer prefixes inserted outside JustType's word/line commands. */
  typedCharacters: number;
  /** Characters inserted by JustType's explicit word/line acceptance commands. */
  commandAcceptedCharacters: number;
  /** Non-empty model completions that became a prediction buffer. */
  suggestions: number;
  /** Prediction buffers for which the provider returned an inline item at least once. */
  suggestionOffers: number;
  /** Confirmed native inline-item commits. */
  visibleAccepts: number;
  /** Characters confirmed through a native inline-item commit. */
  visibleAcceptedCharacters: number;
  /** Offered buffers that ended before their remaining text was consumed. */
  abandonedSuggestions: number;
  /** A subset of abandoned suggestions dismissed through JustType's explicit command. */
  explicitDismissals: number;
  /**
   * Exact edits which consumed an entire offered buffer. This can be Tab, typing,
   * paste, or another extension; VS Code does not identify the source.
   */
  inferredFullBufferConsumes: number;
  wordAccepts: number;
  lineAccepts: number;
  errors: number;
  /** End-to-end time from the last edit or explicit trigger to an offered item. */
  offerLatencySampleCount: number;
  averageOfferLatencyMs: number;
  minOfferLatencyMs: number;
  maxOfferLatencyMs: number;
  p50OfferLatencyMs: number;
  p90OfferLatencyMs: number;
  /** Total valid inference response durations seen in this session. */
  latencySampleCount: number;
  /** Number of recent latency values retained for percentile calculation. */
  latencySamplesRetained: number;
  /** Older latency values no longer retained because the bounded buffer rolled over. */
  latencySamplesDropped: number;
  latencySampleCapacity: number;
  averageLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p90LatencyMs: number;
};
