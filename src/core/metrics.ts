import type { MetricsSnapshot } from './types';

export class SessionMetrics {
  private readonly values = {
    requests: 0,
    aborts: 0,
    staleResponses: 0,
    cacheHits: 0,
    reusedCharacters: 0,
    suggestions: 0,
    wordAccepts: 0,
    lineAccepts: 0,
    errors: 0
  };
  private readonly latencies: number[] = [];

  public increment(key: Exclude<keyof typeof this.values, 'reusedCharacters'>, by = 1): void {
    this.values[key] += by;
  }

  public addReusedCharacters(count: number): void {
    this.values.reusedCharacters += count;
  }

  public recordLatency(durationMs: number): void {
    this.latencies.push(durationMs);
  }

  public snapshot(): MetricsSnapshot {
    return { ...this.values, p50LatencyMs: this.percentile(0.5), p90LatencyMs: this.percentile(0.9) };
  }

  public reset(): void {
    for (const key of Object.keys(this.values) as Array<keyof typeof this.values>) this.values[key] = 0;
    this.latencies.length = 0;
  }

  private percentile(fraction: number): number {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
  }
}
