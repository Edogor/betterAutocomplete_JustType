import assert from 'node:assert/strict';
import { describe, it } from 'mocha';
import { PredictionBuffer } from '../../src/completion/predictionBuffer';

const stamp = { uri: 'file:///test.py', documentVersion: 1, cursorOffset: 10, rightContextHash: 'suffix', epoch: 1 };

describe('PredictionBuffer', () => {
  it('consumes an exact typed prefix at its anchor', () => {
    const buffer = new PredictionBuffer(stamp, ' scanner():');
    assert.equal(buffer.consume({ uri: stamp.uri, rangeOffset: 10, rangeLength: 0, text: ' sc', rightContextHash: 'suffix' }), 'matched');
    assert.equal(buffer.remaining(), 'anner():');
  });

  it('rejects edits with a changed suffix or wrong anchor', () => {
    const buffer = new PredictionBuffer(stamp, ' scanner():');
    assert.equal(buffer.consume({ uri: stamp.uri, rangeOffset: 10, rangeLength: 0, text: ' ', rightContextHash: 'other' }), 'invalid');
    assert.equal(buffer.consume({ uri: stamp.uri, rangeOffset: 11, rangeLength: 0, text: ' ', rightContextHash: 'suffix' }), 'invalid');
  });

  it('extracts partial acceptance segments', () => {
    const buffer = new PredictionBuffer(stamp, ' scan_hosts()\nnext_step()');
    assert.equal(buffer.nextWord(), ' scan_hosts');
    assert.equal(buffer.nextLine(), ' scan_hosts()\n');
  });
});
