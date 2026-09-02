import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { DEFAULT_POLICY } from '../../src/core/types';
import {
  MockPosition,
  MockTextDocument,
  asPosition,
  asTextDocument,
  loadContextBuilder
} from '../helpers/vscodeMock';

const { buildCompletionContext } = loadContextBuilder();

describe('buildCompletionContext', () => {
  it('splits FIM context at the cursor and creates an exact request stamp', () => {
    const document = new MockTextDocument('def scan():\n    return host.lower()\n');
    const position = new MockPosition(1, 11);

    const context = buildCompletionContext(
      asTextDocument(document),
      asPosition(position),
      7,
      { ...DEFAULT_POLICY, prefixChars: 100, suffixChars: 8 },
      'http://127.0.0.1:8012'
    );

    assert.equal(context.inputPrefix, 'def scan():\n');
    assert.equal(context.prompt, '    return ');
    assert.equal(context.inputSuffix, 'host.low');
    assert.equal(context.stamp.uri, 'file:///test.py');
    assert.equal(context.stamp.documentVersion, 1);
    assert.equal(context.stamp.cursorOffset, document.offsetAt(position));
    assert.equal(context.stamp.epoch, 7);
    assert.notEqual(context.stamp.rightContextHash, 'host.low');
  });

  it('keeps only complete recent prefix lines when the character window is exceeded', () => {
    const document = new MockTextDocument('first-line\nsecond-line\nthird-line\n    ret');
    const position = new MockPosition(3, 7);

    const context = buildCompletionContext(
      asTextDocument(document),
      asPosition(position),
      1,
      { ...DEFAULT_POLICY, prefixChars: 15, suffixChars: 20 },
      'http://127.0.0.1:8012'
    );

    assert.equal(context.inputPrefix, 'third-line\n');
    assert.equal(context.prompt, '    ret');
    assert.equal(context.inputSuffix, '');
  });

  it('changes its cache key when relevant FIM context or endpoint changes', () => {
    const document = new MockTextDocument('def scan():\n    ret');
    const position = new MockPosition(1, 7);
    const policy = { ...DEFAULT_POLICY, prefixChars: 100, suffixChars: 20 };
    const first = buildCompletionContext(asTextDocument(document), asPosition(position), 1, policy, 'http://127.0.0.1:8012');
    const sameContextNewEpoch = buildCompletionContext(asTextDocument(document), asPosition(position), 2, policy, 'http://127.0.0.1:8012');
    const otherEndpoint = buildCompletionContext(asTextDocument(document), asPosition(position), 1, policy, 'http://127.0.0.1:8013');

    document.replaceText('def scan():\n    return');
    const changedPrompt = buildCompletionContext(asTextDocument(document), asPosition(new MockPosition(1, 10)), 3, policy, 'http://127.0.0.1:8012');

    assert.equal(first.cacheKey, sameContextNewEpoch.cacheKey);
    assert.notEqual(first.cacheKey, otherEndpoint.cacheKey);
    assert.notEqual(first.cacheKey, changedPrompt.cacheKey);
  });
});
