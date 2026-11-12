import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countLines } from './line-count.mjs';

test('counts the actual number of source lines with or without a final newline', () => {
  assert.equal(countLines(''), 0);
  assert.equal(countLines('\n'), 1);
  assert.equal(countLines('line\r\n'), 1);
  for (const length of [500, 501]) {
    const source = Array(length).fill('line').join('\n');
    assert.equal(countLines(source), length);
    assert.equal(countLines(`${source}\n`), length);
  }
});
