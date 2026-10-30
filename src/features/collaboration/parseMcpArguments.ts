/** 将界面中的参数拆成 argv；只处理引号和转义，不执行 shell 展开。 */
export function parseMcpArguments(input: string): string[] {
  const result: string[] = [];
  let value = '';
  let quote: 'single' | 'double' | null = null;
  let started = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote === 'single') {
      if (char === "'") quote = null;
      else value += char;
    } else if (char === '"') {
      quote = quote === 'double' ? null : 'double';
      started = true;
    } else if (char === "'" && quote === null) {
      quote = 'single';
      started = true;
    } else if (char === '\\') {
      let end = i;
      while (input[end] === '\\') end += 1;
      const count = end - i;
      if (input[end] === '"') {
        value += '\\'.repeat(Math.floor(count / 2));
        if (count % 2 === 1) value += '"';
        else quote = quote === 'double' ? null : 'double';
        i = end;
      } else if (quote === null && count === 1 && end < input.length && /\s|'/.test(input[end])) {
        value += input[end];
        i = end;
      } else {
        value += '\\'.repeat(count);
        i = end - 1;
      }
      started = true;
    } else if (quote === null && /\s/.test(char)) {
      if (started) result.push(value);
      value = '';
      started = false;
    } else {
      value += char;
      started = true;
    }
  }
  if (quote !== null) throw new Error('unclosed quote');
  if (started) result.push(value);
  return result;
}
