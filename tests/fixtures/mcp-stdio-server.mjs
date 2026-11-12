// Deterministic local MCP server used by the desktop IPC integration test.
import { createInterface } from 'node:readline';

for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  let result;
  switch (request.method) {
    case 'initialize':
      result = {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'desktop-test', version: '1.0.0' },
        capabilities: { tools: { listChanged: false } },
      };
      break;
    case 'tools/list':
      result = { tools: [{ name: 'echo', description: 'Echo text', inputSchema: {
        type: 'object', properties: { text: { type: 'string' } }, required: ['text'],
      } }] };
      break;
    case 'tools/call':
      result = { content: [{ type: 'text', text: `${process.env.TEST_GREETING}: ${request.params.arguments.text}` }], isError: false };
      break;
    default:
      result = {};
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
}
