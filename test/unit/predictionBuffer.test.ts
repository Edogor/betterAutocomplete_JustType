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

  it('never lets word acceptance cross a line and keeps a leading newline with its line', () => {
    const buffer = new PredictionBuffer(stamp, '\n    next_step()\nafter()');
    assert.equal(buffer.nextWord(), '\n');
    assert.equal(buffer.nextLine(), '\n    next_step()\n');
  });

  it('accepts appended stream chunks after already-consumed text and stays open while temporarily empty', () => {
    const buffer = new PredictionBuffer(stamp, 'return ', true);
    assert.equal(buffer.consume({ uri: stamp.uri, rangeOffset: 10, rangeLength: 0, text: 'return ', rightContextHash: 'suffix' }), 'matched');
    assert.equal(buffer.isEmpty(), true);
    assert.equal(buffer.isStreamOpen(), true);
    buffer.append('hosts');
    assert.equal(buffer.remaining(), 'hosts');
    buffer.finishStream();
    assert.equal(buffer.isStreamOpen(), false);
  });

  it('retains a long streamed continuation without a line window', () => {
    const text = Array.from({ length: 120 }, (_, index) => `word${index}`).join(' ');
    const buffer = new PredictionBuffer(stamp, '', true);
    buffer.append(text);
    assert.equal(buffer.visibleText(), text);
    assert.ok(buffer.visibleText().split(/\s+/).length > 100);
  });
});
