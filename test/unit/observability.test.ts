import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { formatLogEvent } from '../../src/core/observability';

describe('observability', () => {
  it('formats structured events and omits undefined fields', () => {
    const event = JSON.parse(formatLogEvent('completion.response', { durationMs: 480, cachedTokens: undefined })) as Record<string, unknown>;
    assert.equal(event.event, 'completion.response');
    assert.equal(event.durationMs, 480);
    assert.equal('cachedTokens' in event, false);
    assert.equal(typeof event.at, 'string');
  });
});
