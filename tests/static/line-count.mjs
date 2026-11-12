/** Count physical source lines without treating a final newline as an extra line. */
export function countLines(source) {
  if (source.length === 0) return 0;
  return source.split('\n').length - Number(source.endsWith('\n'));
}
