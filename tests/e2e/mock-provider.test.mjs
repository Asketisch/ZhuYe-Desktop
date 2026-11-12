// 独立检查窗口模型替身的端口发布、请求过滤与 SSE 形状。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

test('local provider serves only the synthetic prompt as Anthropic SSE', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'window-provider-'));
  const portFile = join(dir, 'port');
  const script = fileURLToPath(new URL('./mock-provider.mjs', import.meta.url));
  const child = spawn(process.execPath, [script, portFile], { stdio: 'ignore' });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  try {
    let port = '';
    for (let i = 0; i < 100 && !port; i++) {
      port = await readFile(portFile, 'utf8').catch(() => '');
      if (child.exitCode !== null) break;
      if (!port) await delay(50);
    }
    assert.match(port, /^\d+$/);
    const endpoint = `http://127.0.0.1:${port}/v1/messages`;
    const reply = await fetch(endpoint, { method: 'POST', body: 'window-agent-chain-test' });
    assert.equal(reply.status, 200);
    assert.match(reply.headers.get('content-type') ?? '', /^text\/event-stream/);
    const text = await reply.text();
    assert.match(text, /window second reply verified/);
    assert.match(text, /event: message_stop/);
    const tool = await fetch(endpoint, { method: 'POST', body: 'window-tool-chain-test' });
    assert.match(await tool.text(), /toolu_window/);
    const interruptPrompt = JSON.stringify({ messages: [{ role: 'user', content: 'window-interrupt-start-test' }] });
    const delayed = await fetch(endpoint, { method: 'POST', body: interruptPrompt });
    assert.match(await delayed.text(), /window first turn should be interrupted/);
    const resumed = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [
      { role: 'user', content: 'window-interrupt-start-test' },
      { role: 'assistant', content: 'window first turn should be interrupted' },
      { role: 'user', content: 'window-interrupt-resume-test' },
    ] }) });
    assert.match(await resumed.text(), /window interrupt turn verified/);
    const resumedWithoutHistory = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [
      { role: 'user', content: 'window-interrupt-resume-test' },
    ] }) });
    assert.match(await resumedWithoutHistory.text(), /window interrupt turn verified/);
    const resultBody = (content, is_error = false) => JSON.stringify({ messages: [
      { role: 'user', content: 'window-tool-chain-test' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_window', content, is_error }] },
    ] });
    const result = await fetch(endpoint, { method: 'POST', body: resultBody('tool-approved-marker') });
    assert.match(await result.text(), /window tool round verified/);
    const missing = await fetch(endpoint, { method: 'POST', body: resultBody('wrong') });
    assert.equal(missing.status, 400);
    const failed = await fetch(endpoint, { method: 'POST', body: resultBody('tool-approved-marker', true) });
    assert.equal(failed.status, 400);
    const deniedPrompt = JSON.stringify({ messages: [{ role: 'user', content: 'window-tool-deny-test' }] });
    const deniedTool = await fetch(endpoint, { method: 'POST', body: deniedPrompt });
    assert.match(await deniedTool.text(), /toolu_window_deny/);
    const denialResult = (is_error) => JSON.stringify({ messages: [
      { role: 'user', content: 'window-tool-deny-test' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_window_deny', content: 'denied', is_error }] },
    ] });
    const notDenied = await fetch(endpoint, { method: 'POST', body: denialResult(false) });
    assert.equal(notDenied.status, 400);
    const denied = await fetch(endpoint, { method: 'POST', body: denialResult(true) });
    assert.match(await denied.text(), /window denial verified/);
    const writePrompt = JSON.stringify({ messages: [{ role: 'user', content: 'window-tool-write-test' }] });
    const write = await fetch(endpoint, { method: 'POST', body: writePrompt });
    assert.match(await write.text(), /toolu_window_write/);
    const writeResult = (content, is_error) => JSON.stringify({ messages: [
      { role: 'user', content: 'window-tool-write-test' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_window_write', content, is_error }] },
    ] });
    const writeFailed = await fetch(endpoint, { method: 'POST', body: writeResult('tool-write-marker', true) });
    assert.equal(writeFailed.status, 400);
    const writeDone = await fetch(endpoint, { method: 'POST', body: writeResult('tool-write-marker', false) });
    assert.match(await writeDone.text(), /window tool write verified/);
    const questionPrompt = { role: 'user', content: 'window-question-chain-test' };
    const question = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [questionPrompt] }) });
    assert.match(await question.text(), /ask_user_question/);
    const questionResult = (answer) => JSON.stringify({ messages: [questionPrompt, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_window_question', content: [{ type: 'text', text: JSON.stringify(answer) }], is_error: false },
    ] }] });
    const wrongAnswer = await fetch(endpoint, { method: 'POST', body: questionResult({ answers: [{ selected: [0] }] }) });
    assert.equal(wrongAnswer.status, 400);
    const incomplete = await fetch(endpoint, { method: 'POST', body: questionResult({ answers: [{ selected: [1] }] }) });
    assert.equal(incomplete.status, 400);
    const answered = await fetch(endpoint, { method: 'POST', body: questionResult({ answers: [
      { selected: [1] }, { selected: [0, 2], custom: 'window-custom-answer' },
    ] }) });
    assert.match(await answered.text(), /window question answer verified/);
    const inputPrompt = { role: 'user', content: 'window-input-chain-test' };
    const input = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [questionPrompt, inputPrompt] }) });
    assert.match(await input.text(), /ask_user/);
    const inputResult = (value) => JSON.stringify({ messages: [questionPrompt, inputPrompt, { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_window_input', content: [{ type: 'text', text: value }], is_error: false },
    ] }] });
    const wrongInput = await fetch(endpoint, { method: 'POST', body: inputResult('wrong') });
    assert.equal(wrongInput.status, 400);
    const answeredInput = await fetch(endpoint, { method: 'POST', body: inputResult('window-synthetic-secret') });
    assert.match(await answeredInput.text(), /window input answer verified/);
    const historic = [
      { role: 'user', content: 'window-tool-write-test' },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_window_write', content: 'tool-write-marker', is_error: false }] },
    ];
    const newTurn = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [
      ...historic, { role: 'user', content: 'window-tool-chain-test' },
    ] }) });
    assert.match(await newTurn.text(), /toolu_window/);
    const repeated = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [
      ...historic, { role: 'user', content: 'window-tool-write-test' },
    ] }) });
    assert.match(await repeated.text(), /toolu_window_write/);
    const unknownAfterKnown = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ messages: [
      ...historic, { role: 'user', content: 'not a known scenario' },
    ] }) });
    assert.equal(unknownAfterKnown.status, 400);
    const invalid = await fetch(endpoint, { method: 'POST', body: 'unexpected' });
    assert.equal(invalid.status, 400);
  } finally {
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});
