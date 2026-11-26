import { describe, expect, it } from 'vitest';
import { splitAssistantText } from './assistantText';

describe('splitAssistantText', () => {
  it('closed <think> block is split into thinking and content', () => {
    const { thinking, content } = splitAssistantText(
      '<think>用户在打招呼,不需要工具。</think>你好!有什么可以帮你?',
    );
    expect(thinking).toBe('用户在打招呼,不需要工具。');
    expect(content).toBe('你好!有什么可以帮你?');
  });

  it('standard DeepSeek shape (think block then newline then answer)', () => {
    const { thinking, content } = splitAssistantText('<think>\n推理过程。\n</think>\n答案正文');
    expect(thinking).toBe('推理过程。');
    expect(content).toBe('答案正文');
  });

  it('unclosed <think> (streaming) is all thinking, content empty', () => {
    const { thinking, content } = splitAssistantText('<think>先分析一下需求,然后');
    expect(thinking).toBe('先分析一下需求,然后');
    expect(content).toBe('');
  });

  it('open tag with same-line remainder folds the remainder into thinking', () => {
    const { thinking, content } = splitAssistantText('<think>分析中');
    expect(thinking).toBe('分析中');
    expect(content).toBe('');
  });

  it('alias tags (thinking / thought / reasoning) are recognized', () => {
    for (const tag of ['thinking', 'thought', 'reasoning']) {
      const { thinking, content } = splitAssistantText(`<${tag}>推理</${tag}>正文`);
      expect(thinking).toBe('推理');
      expect(content).toBe('正文');
    }
  });

  it('<think> inside a code fence is NOT a split point', () => {
    const raw = '看这个例子:\n```\n<think>fake</think>\n```\n完事';
    const { thinking, content } = splitAssistantText(raw);
    expect(thinking).toBeNull();
    expect(content).toBe(raw);
  });

  it('inline (mid-line) <think> is left as plain text — line-start anchor avoids false positives', () => {
    const raw = '嗯..<think>结论:A</think>答案是 A。';
    const { thinking, content } = splitAssistantText(raw);
    expect(thinking).toBeNull();
    expect(content).toBe(raw);
  });

  it('FINAL ANSWER markers at line start are stripped, remainder kept', () => {
    const { content } = splitAssistantText(
      'FINAL ANSWER: 你好!当前没有需要处理的编码任务。\n等待你提出具体需求。',
    );
    expect(content).not.toContain('FINAL ANSWER');
    expect(content).toContain('你好!当前没有需要处理的编码任务。');
    expect(content).toContain('等待你提出具体需求。');
  });

  it('markdown-decorated markers (bold / blockquote / list) are stripped too', () => {
    for (const line of ['**FINAL ANSWER:** done', '> FINAL ANSWER: done', '- FINAL ANSWER: done', 'FINAL ANSWER：完成']) {
      const { content } = splitAssistantText(`${line}\nnext`);
      expect(content).not.toContain('FINAL ANSWER');
      expect(content).toContain(line.includes('完成') ? '完成' : 'done');
    }
  });

  it('literal template echo (FINAL ANSWER: <answer>) collapses to empty-ish text', () => {
    const { content } = splitAssistantText('FINAL ANSWER: <answer>');
    expect(content).not.toContain('FINAL ANSWER');
    expect(content).not.toContain('<answer>');
  });

  it('plain text without markers or think tags is returned untouched', () => {
    const raw = '# 标题\n\n正文 **加粗**。\n';
    const { thinking, content } = splitAssistantText(raw);
    expect(thinking).toBeNull();
    expect(content).toBe(raw);
  });

  it('multi-occurrence markers (repeated nudges) are all stripped', () => {
    const raw = [
      'FINAL ANSWER: 第一次回答',
      '确认状态:',
      '- 没有未满足的需求',
      'FINAL ANSWER: 第二次回答',
    ].join('\n');
    const { content } = splitAssistantText(raw);
    expect(content).not.toContain('FINAL ANSWER');
    expect(content).toContain('第一次回答');
    expect(content).toContain('第二次回答');
    expect(content).toContain('确认状态:');
  });

  it('think block content also gets marker-stripped', () => {
    const { thinking, content } = splitAssistantText(
      '<think>FINAL ANSWER: 草稿</think>正式回答',
    );
    expect(thinking).toBe('草稿');
    expect(content).toBe('正式回答');
  });
});
