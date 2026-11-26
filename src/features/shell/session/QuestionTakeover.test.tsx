/**
 * QuestionTakeover —— 多题页签呈现测试。
 *
 * v1.13:原先所有问题竖向堆叠（三题就把 composer 座位撑成一整屏），
 * 改为**一题一页签**、一次只答一道；答案按题号保存在组件内，切页签不丢。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { QuestionTakeover } from '@/features/shell/session/Takeovers';
import { useAgentStore } from '@/stores/agentStore';
import type { PendingQuestion } from '@/stores/agent/types';

const QUESTION: PendingQuestion = {
  id: 'q-1',
  kind: 'question',
  turnId: 'turn-1',
  payload: {
    questions: [
      {
        header: 'Choice',
        question: 'Choose a fruit?',
        multi_select: false,
        options: [
          { label: 'Apple', description: 'first' },
          { label: 'Pear', description: 'second' },
        ],
      },
      {
        header: 'Features',
        question: 'Choose features?',
        multi_select: true,
        options: [
          { label: 'Auth', description: 'first' },
          { label: 'Audit', description: 'second' },
          { label: 'Cache', description: 'third' },
        ],
      },
    ],
  },
} as unknown as PendingQuestion;

function renderTakeover(question = QUESTION) {
  return render(
    <I18nProvider>
      <QuestionTakeover question={question} />
    </I18nProvider>,
  );
}

describe('QuestionTakeover · 多题页签', () => {
  beforeEach(() => {
    localStorage.setItem('zhuye.locale', 'en');
  });
  afterEach(() => cleanup());

  it('只渲染当前页签的选项（不再全部堆叠）', () => {
    renderTakeover();
    // 第一题可见、第二题不可见。
    expect(screen.getByText('Choose a fruit?')).toBeDefined();
    expect(screen.getByText('Pear')).toBeDefined();
    expect(screen.queryByText('Choose features?')).toBeNull();
    expect(screen.queryByText('Cache')).toBeNull();
  });

  it('页签条按 header 命名，点击切到另一题', () => {
    renderTakeover();
    expect(screen.getByTestId('question-tab-0').textContent).toContain('Choice');
    expect(screen.getByTestId('question-tab-1').textContent).toContain('Features');

    fireEvent.click(screen.getByTestId('question-tab-1'));
    expect(screen.getByText('Choose features?')).toBeDefined();
    expect(screen.queryByText('Choose a fruit?')).toBeNull();
  });

  it('切页签不丢已选答案，提交时一次性回传全部题', async () => {
    const answer = vi.spyOn(useAgentStore.getState(), 'answerQuestion').mockResolvedValue(undefined);
    renderTakeover();

    // 第一题选 Pear。
    fireEvent.click(screen.getByText('Pear'));
    // 切到第二题选 Auth。
    fireEvent.click(screen.getByTestId('question-tab-1'));
    fireEvent.click(screen.getByText('Auth'));
    // 切回第一题：选择仍在。
    fireEvent.click(screen.getByTestId('question-tab-0'));
    expect(screen.getByText('Pear').closest('button')?.getAttribute('data-sel')).toBe('true');

    fireEvent.click(screen.getByTestId('question-submit'));
    await vi.waitFor(() => expect(answer).toHaveBeenCalled());
    const [, payload] = answer.mock.calls[0] as unknown as [string, { answers: { selected: number[] }[] }];
    expect(payload.answers[0].selected).toEqual([1]); // Pear
    expect(payload.answers[1].selected).toEqual([0]); // Auth
    answer.mockRestore();
  });

  it('已答的页签标记 data-answered', () => {
    renderTakeover();
    expect(screen.getByTestId('question-tab-0').getAttribute('data-answered')).toBeNull();
    fireEvent.click(screen.getByText('Pear'));
    expect(screen.getByTestId('question-tab-0').getAttribute('data-answered')).toBe('true');
  });

  it('单题时不出页签条（没有可切换的对象）', () => {
    const single = {
      ...QUESTION,
      payload: { questions: [(QUESTION.payload as { questions: unknown[] }).questions[0]] },
    } as unknown as PendingQuestion;
    renderTakeover(single);
    expect(screen.queryByTestId('question-tabs')).toBeNull();
    expect(screen.getByText('Choose a fruit?')).toBeDefined();
  });
});
