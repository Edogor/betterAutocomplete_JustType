import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { LruCache } from '../../src/core/lruCache';

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const cache = new LruCache<number>(2, 1_000);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.get('a'), 1);
    cache.set('c', 3);
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('a'), 1);
  });
});
