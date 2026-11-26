import { describe, expect, it } from 'vitest';
import { parseMcpArguments } from './parseMcpArguments';

describe('parseMcpArguments', () => {
  it('preserves empty and quoted arguments without shell expansion', () => {
    expect(parseMcpArguments(`one 'two three' "" a\\ b '$HOME'`))
      .toEqual(['one', 'two three', '', 'a b', '$HOME']);
  });

  it('preserves backslashes and supports escaped quotes and a quoted trailing slash', () => {
    expect(parseMcpArguments('"C:\\path with space\\\\" "say \\"hi\\""'))
      .toEqual(['C:\\path with space\\', 'say "hi"']);
  });

  it('rejects unterminated quotes', () => {
    expect(() => parseMcpArguments("'unfinished")).toThrow();
    expect(() => parseMcpArguments('"unfinished')).toThrow();
  });
});
