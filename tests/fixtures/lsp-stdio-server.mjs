// Deterministic LSP server for the desktop IPC integration test.
import { appendFileSync, writeFileSync } from 'node:fs';

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(request) {
  if (request.method === 'textDocument/didOpen') {
    const document = request.params.textDocument;
    if (document.text.includes('fixture_lsp_exit_now')) process.exit(17);
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri: document.uri,
        diagnostics: [{
          range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
          severity: 2,
          source: 'fixture-lsp',
          code: 'TEST001',
          message: document.text.includes('fixture_lsp_source') ? 'fixture diagnostic' : 'unexpected document content',
        }],
      },
    });
    return;
  }
  if (request.method === 'exit') process.exit(0);
  if (request.id === undefined) return;
  if (request.method === 'shutdown' && process.env.LSP_SHUTDOWN_MARKER) {
    writeFileSync(process.env.LSP_SHUTDOWN_MARKER, 'shutdown');
  }
  let result = null;
  if (request.method === 'initialize') {
    result = { capabilities: { textDocumentSync: 1, hoverProvider: true }, serverInfo: { name: 'desktop-lsp-fixture', version: '1' } };
    if (process.env.LSP_INITIALIZING_MARKER) {
      appendFileSync(process.env.LSP_INITIALIZING_MARKER, `${process.pid}\n`);
      setTimeout(() => send({ jsonrpc: '2.0', id: request.id, result }), 1000);
      return;
    }
  } else if (request.method === 'textDocument/hover') {
    result = { contents: { kind: 'plaintext', value: 'fixture hover response' } };
  }
  send({ jsonrpc: '2.0', id: request.id, result });
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const separator = buffer.indexOf('\r\n\r\n');
    if (separator < 0) return;
    const headers = buffer.subarray(0, separator).toString('ascii');
    const length = Number(/^Content-Length:\s*(\d+)\s*$/im.exec(headers)?.[1]);
    if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Invalid Content-Length');
    const end = separator + 4 + length;
    if (buffer.length < end) return;
    const request = JSON.parse(buffer.subarray(separator + 4, end).toString('utf8'));
    buffer = buffer.subarray(end);
    handle(request);
  }
});
