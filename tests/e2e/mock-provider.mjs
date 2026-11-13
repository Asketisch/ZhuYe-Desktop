// 窗口测试专用的本地 Anthropic SSE 网关；只接受合成测试消息。
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const portFile = process.argv[2];
if (!portFile) throw new Error('缺少端口文件');
function textEvents(text) { return [
  ['message_start', { type: 'message_start', message: { id: 'window-test', model: 'claude-mock', usage: { input_tokens: 10 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } }],
  ['message_stop', { type: 'message_stop' }],
]; }

function toolEvents(id, args, name = 'bash') { return [
  ['message_start', { type: 'message_start', message: { id: 'window-tool', model: 'claude-mock', usage: { input_tokens: 10 } } }],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(typeof args === 'string' ? { cmd: args } : args) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }],
  ['message_stop', { type: 'message_stop' }],
]; }

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/v1/messages') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let events;
    let delayed = false;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { messages: [{ role: 'user', content: body }] };
    }
    const messages = parsed.messages ?? [];
    const userText = (message) => message.role !== 'user' ? '' :
      (typeof message.content === 'string' ? message.content :
        (Array.isArray(message.content) ? message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n') : ''));
    const turnStart = messages.findLastIndex((message) => userText(message) !== '');
    const latestUserText = turnStart < 0 ? '' : userText(messages[turnStart]);
    const turnMessages = turnStart < 0 ? [] : messages.slice(turnStart);
    const toolResult = (id) => turnMessages.flatMap((message) => Array.isArray(message.content) ? message.content : [])
      .find((block) => block.type === 'tool_result' && block.tool_use_id === id);
    if (latestUserText.includes('window-question-chain-test')) {
      const result = toolResult('toolu_window_question');
      if (result) {
        const text = Array.isArray(result.content) ? result.content[0]?.text : result.content;
        let answers;
        try { answers = JSON.parse(text); } catch { answers = null; }
        if (result.is_error || JSON.stringify(answers) !== JSON.stringify({ answers: [
          { selected: [1] }, { selected: [0, 2], custom: 'window-custom-answer' },
        ] })) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"unexpected question answer"}');
          return;
        }
        events = textEvents('window question answer verified');
      } else {
        events = toolEvents('toolu_window_question', { questions: [
          { header: 'Choice', question: 'Choose a fruit?', multi_select: false, options: [{ label: 'Apple', description: 'first' }, { label: 'Pear', description: 'second' }] },
          { header: 'Features', question: 'Choose features?', multi_select: true, options: [{ label: 'Auth', description: 'first' }, { label: 'Audit', description: 'second' }, { label: 'Cache', description: 'third' }] },
        ] }, 'ask_user_question');
      }
    } else if (latestUserText.includes('window-input-chain-test')) {
      const result = toolResult('toolu_window_input');
      if (result) {
        const text = Array.isArray(result.content) ? result.content[0]?.text : result.content;
        if (result.is_error || text !== 'window-synthetic-secret') {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"unexpected input answer"}');
          return;
        }
        events = textEvents('window input answer verified');
      } else {
        events = toolEvents('toolu_window_input', { prompt: 'Enter a test value:', secret: true, placeholder: 'Test value' }, 'ask_user');
      }
    } else if (latestUserText.includes('window-interrupt-start-test')) {
      console.log('window interrupt start received');
      events = textEvents('window first turn should be interrupted');
      delayed = true;
    } else if (latestUserText.includes('window-interrupt-resume-test')) {
      events = textEvents('window interrupt turn verified');
    } else if (latestUserText.includes('window-tool-write-test')) {
      const result = toolResult('toolu_window_write');
      if (result) {
        console.log('window write tool result:', JSON.stringify(result));
        if (result.is_error || !JSON.stringify(result.content).includes('tool-write-marker')) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"tool write failed"}');
          return;
        }
        events = textEvents('window tool write verified');
      } else {
      events = toolEvents('toolu_window_write', 'printf tool-write-marker > approved-tool.txt && cat approved-tool.txt');
      }
    } else if (latestUserText.includes('window-tool-deny-test')) {
      const result = toolResult('toolu_window_deny');
      if (result) {
        console.log('window denied tool result:', JSON.stringify(result));
        if (!result.is_error) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"denial not reported"}');
          return;
        }
        events = textEvents('window denial verified');
      } else {
        events = toolEvents('toolu_window_deny', 'printf should-not-exist > denied-tool.txt');
      }
    } else if (latestUserText.includes('window-tool-chain-test')) {
      const result = toolResult('toolu_window');
      if (result) {
        console.log('window tool result:', JSON.stringify(result));
        if (result.is_error || !JSON.stringify(result.content).includes('tool-approved-marker')) {
          res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"missing tool output"}');
          return;
        }
        events = textEvents('window tool round verified');
      } else {
        events = toolEvents('toolu_window', 'printf tool-approved-marker');
      }
    } else if (latestUserText.includes('window-agent-chain-test')) {
      events = textEvents('window second reply verified');
    } else {
      res.writeHead(400, { 'content-type': 'application/json' }).end('{"error":"unexpected prompt"}');
      return;
    }
    const send = () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    };
    if (delayed) setTimeout(send, 4000);
    else send();
  });
});
server.listen(0, '127.0.0.1', () => {
  writeFileSync(portFile, String(server.address().port));
});
