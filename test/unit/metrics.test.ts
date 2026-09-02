import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { SessionMetrics } from '../../src/core/metrics';

describe('SessionMetrics', () => {
  it('keeps only a bounded rolling latency sample while retaining aggregate statistics', () => {
    const metrics = new SessionMetrics(3);
    for (const duration of [10, 20, 30, 40, 50]) metrics.recordLatency(duration);

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.latencySampleCapacity, 3);
    assert.equal(snapshot.latencySampleCount, 5);
    assert.equal(snapshot.latencySamplesRetained, 3);
    assert.equal(snapshot.latencySamplesDropped, 2);
    assert.equal(snapshot.averageLatencyMs, 30);
    assert.equal(snapshot.minLatencyMs, 10);
    assert.equal(snapshot.maxLatencyMs, 50);
    assert.equal(snapshot.p50LatencyMs, 40);
    assert.equal(snapshot.p90LatencyMs, 50);
  });

  it('records only content-free lifecycle aggregates and resets them', () => {
    const metrics = new SessionMetrics();
    metrics.increment('requests');
    metrics.increment('responses');
    metrics.increment('suggestions');
    metrics.addReusedCharacters(5);
    metrics.addTypedCharacters(2);
    metrics.addCommandAcceptedCharacters(3);
    metrics.recordSuggestionOffer();
    metrics.recordSuggestionOffer();
    metrics.recordVisibleAccept(4);
    metrics.recordOfferLatency(20);
    metrics.recordInferredFullBufferConsume();
    metrics.recordAbandonedSuggestion(true);

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.requests, 1);
    assert.equal(snapshot.responses, 1);
    assert.equal(snapshot.suggestions, 1);
    assert.equal(snapshot.reusedCharacters, 5);
    assert.equal(snapshot.typedCharacters, 2);
    assert.equal(snapshot.commandAcceptedCharacters, 3);
    assert.equal(snapshot.suggestionOffers, 2);
    assert.equal(snapshot.visibleAccepts, 1);
    assert.equal(snapshot.visibleAcceptedCharacters, 4);
    assert.equal(snapshot.offerLatencySampleCount, 1);
    assert.equal(snapshot.p50OfferLatencyMs, 20);
    assert.equal(snapshot.inferredFullBufferConsumes, 1);
    assert.equal(snapshot.abandonedSuggestions, 1);
    assert.equal(snapshot.explicitDismissals, 1);

    metrics.reset();
    const reset = metrics.snapshot();
    assert.equal(reset.requests, 0);
    assert.equal(reset.suggestionOffers, 0);
    assert.equal(reset.latencySampleCount, 0);
    assert.equal(reset.offerLatencySampleCount, 0);
    assert.equal(reset.p50LatencyMs, 0);
  });

  it('ignores invalid duration values instead of retaining them', () => {
    const metrics = new SessionMetrics();
    metrics.recordLatency(Number.NaN);
    metrics.recordLatency(-1);
    assert.equal(metrics.snapshot().latencySampleCount, 0);
  });
});
