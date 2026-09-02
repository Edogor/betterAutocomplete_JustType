import type { MetricsSnapshot } from './types';

export const DEFAULT_LATENCY_SAMPLE_CAPACITY = 256;

type MetricCounter =
  | 'requests'
  | 'responses'
  | 'aborts'
  | 'staleResponses'
  | 'cacheHits'
  | 'reusedCharacters'
  | 'typedCharacters'
  | 'commandAcceptedCharacters'
  | 'suggestions'
  | 'suggestionOffers'
  | 'visibleAccepts'
  | 'visibleAcceptedCharacters'
  | 'abandonedSuggestions'
  | 'explicitDismissals'
  | 'inferredFullBufferConsumes'
  | 'wordAccepts'
  | 'lineAccepts'
  | 'errors';

type CounterValues = Record<MetricCounter, number>;

/**
 * In-memory, content-free session telemetry.
 *
 * Percentiles use a bounded rolling sample so a long-running VS Code session
 * cannot retain an unbounded latency array. The mean, min and max remain
 * aggregate values across the whole session and do not retain individual data.
 */
export class SessionMetrics {
  private readonly values: CounterValues = {
    requests: 0,
    responses: 0,
    aborts: 0,
    staleResponses: 0,
    cacheHits: 0,
    reusedCharacters: 0,
    typedCharacters: 0,
    commandAcceptedCharacters: 0,
    suggestions: 0,
    suggestionOffers: 0,
    visibleAccepts: 0,
    visibleAcceptedCharacters: 0,
    abandonedSuggestions: 0,
    explicitDismissals: 0,
    inferredFullBufferConsumes: 0,
    wordAccepts: 0,
    lineAccepts: 0,
    errors: 0
  };
  private readonly latencies: number[] = [];
  private latencyWriteIndex = 0;
  private latencySampleCount = 0;
  private latencySumMs = 0;
  private minLatencyMs = 0;
  private maxLatencyMs = 0;
  private readonly offerLatencies: number[] = [];
  private offerLatencyWriteIndex = 0;
  private offerLatencySampleCount = 0;
  private offerLatencySumMs = 0;
  private minOfferLatencyMs = 0;
  private maxOfferLatencyMs = 0;

  public constructor(private readonly latencySampleCapacity = DEFAULT_LATENCY_SAMPLE_CAPACITY) {
    if (!Number.isSafeInteger(latencySampleCapacity) || latencySampleCapacity < 1) {
      throw new Error('latencySampleCapacity must be a positive integer');
    }
  }

  public increment(key: MetricCounter, by = 1): void {
    this.add(key, by);
  }

  public addReusedCharacters(count: number): void {
    this.add('reusedCharacters', count);
  }

  public addTypedCharacters(count: number): void {
    this.add('typedCharacters', count);
  }

  public addCommandAcceptedCharacters(count: number): void {
    this.add('commandAcceptedCharacters', count);
  }

  public recordSuggestionOffer(): void {
    this.add('suggestionOffers');
  }

  public recordVisibleAccept(characters: number): void {
    this.add('visibleAccepts');
    this.add('visibleAcceptedCharacters', characters);
  }

  public recordAbandonedSuggestion(explicitDismissal = false): void {
    this.add('abandonedSuggestions');
    if (explicitDismissal) this.add('explicitDismissals');
  }

  public recordInferredFullBufferConsume(): void {
    this.add('inferredFullBufferConsumes');
  }

  public recordLatency(durationMs: number): void {
    this.recordDuration(durationMs, this.latencies, 'latency');
  }

  public recordOfferLatency(durationMs: number): void {
    this.recordDuration(durationMs, this.offerLatencies, 'offerLatency');
  }

  private recordDuration(durationMs: number, values: number[], kind: 'latency' | 'offerLatency'): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const roundedDuration = Math.round(durationMs);
    if (kind === 'latency') {
      this.latencySampleCount += 1;
      this.latencySumMs += roundedDuration;
      if (this.latencySampleCount === 1) {
        this.minLatencyMs = roundedDuration;
        this.maxLatencyMs = roundedDuration;
      } else {
        this.minLatencyMs = Math.min(this.minLatencyMs, roundedDuration);
        this.maxLatencyMs = Math.max(this.maxLatencyMs, roundedDuration);
      }
      if (values.length < this.latencySampleCapacity) {
        values.push(roundedDuration);
        return;
      }
      values[this.latencyWriteIndex] = roundedDuration;
      this.latencyWriteIndex = (this.latencyWriteIndex + 1) % this.latencySampleCapacity;
    } else {
      this.offerLatencySampleCount += 1;
      this.offerLatencySumMs += roundedDuration;
      if (this.offerLatencySampleCount === 1) {
        this.minOfferLatencyMs = roundedDuration;
        this.maxOfferLatencyMs = roundedDuration;
      } else {
        this.minOfferLatencyMs = Math.min(this.minOfferLatencyMs, roundedDuration);
        this.maxOfferLatencyMs = Math.max(this.maxOfferLatencyMs, roundedDuration);
      }
      if (values.length < this.latencySampleCapacity) {
        values.push(roundedDuration);
        return;
      }
      values[this.offerLatencyWriteIndex] = roundedDuration;
      this.offerLatencyWriteIndex = (this.offerLatencyWriteIndex + 1) % this.latencySampleCapacity;
    }
  }

  public snapshot(): MetricsSnapshot {
    const retained = this.latencies.length;
    return {
      ...this.values,
      latencySampleCount: this.latencySampleCount,
      latencySamplesRetained: retained,
      latencySamplesDropped: Math.max(0, this.latencySampleCount - retained),
      latencySampleCapacity: this.latencySampleCapacity,
      averageLatencyMs: this.latencySampleCount === 0 ? 0 : Math.round(this.latencySumMs / this.latencySampleCount),
      minLatencyMs: this.latencySampleCount === 0 ? 0 : this.minLatencyMs,
      maxLatencyMs: this.latencySampleCount === 0 ? 0 : this.maxLatencyMs,
      p50LatencyMs: this.percentile(this.latencies, 0.5),
      p90LatencyMs: this.percentile(this.latencies, 0.9),
      offerLatencySampleCount: this.offerLatencySampleCount,
      averageOfferLatencyMs: this.offerLatencySampleCount === 0 ? 0 : Math.round(this.offerLatencySumMs / this.offerLatencySampleCount),
      minOfferLatencyMs: this.offerLatencySampleCount === 0 ? 0 : this.minOfferLatencyMs,
      maxOfferLatencyMs: this.offerLatencySampleCount === 0 ? 0 : this.maxOfferLatencyMs,
      p50OfferLatencyMs: this.percentile(this.offerLatencies, 0.5),
      p90OfferLatencyMs: this.percentile(this.offerLatencies, 0.9)
    };
  }

  public reset(): void {
    for (const key of Object.keys(this.values) as MetricCounter[]) this.values[key] = 0;
    this.latencies.length = 0;
    this.latencyWriteIndex = 0;
    this.latencySampleCount = 0;
    this.latencySumMs = 0;
    this.minLatencyMs = 0;
    this.maxLatencyMs = 0;
    this.offerLatencies.length = 0;
    this.offerLatencyWriteIndex = 0;
    this.offerLatencySampleCount = 0;
    this.offerLatencySumMs = 0;
    this.minOfferLatencyMs = 0;
    this.maxOfferLatencyMs = 0;
  }

  private add(key: MetricCounter, by = 1): void {
    if (!Number.isFinite(by) || by <= 0) return;
    this.values[key] += Math.floor(by);
  }

  private percentile(values: number[], fraction: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return sorted[index];
  }
}
