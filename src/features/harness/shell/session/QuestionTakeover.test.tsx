/**
 * QuestionTakeover —— 多题页签呈现测试。
 *
 * v1.13:原先所有问题竖向堆叠（三题就把 composer 座位撑成一整屏），
 * 改为**一题一页签**、一次只答一道；答案按题号保存在组件内，切页签不丢。
 * v1.x:提交门控契约 —— 全部题都「选了选项或填了自定义」才「显示」
 * 提交按钮(未答完不渲染,而非置灰);Skip 不受门控;多 agent 同回合
 * 提问的挂起卡连坐清理已在 reducer 修复。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { QuestionTakeover } from '@/features/harness/shell/session/Takeovers';
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

  it('未全部作答时不渲染提交,全部答完才出现且可点', () => {
    renderTakeover();
    // 一题未答 → 不显示提交按钮。
    expect(screen.queryByTestId('question-submit')).toBeNull();
    // 只答第一题仍不够 —— 第二题(Features)还没答。
    fireEvent.click(screen.getByText('Pear'));
    expect(screen.queryByTestId('question-submit')).toBeNull();
    // 全部作答后才出现,且可直接点击。
    fireEvent.click(screen.getByTestId('question-tab-1'));
    fireEvent.click(screen.getByText('Auth'));
    const submit = screen.getByTestId('question-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  it('空 questions 的请求不门控(空答案即可解锁引擎)', () => {
    const empty = { ...QUESTION, payload: { questions: [] } } as unknown as PendingQuestion;
    renderTakeover(empty);
    expect((screen.getByTestId('question-submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('Skip 不受提交门控:未作答时无提交按钮,也能整体回传空选择', async () => {
    const answer = vi.spyOn(useAgentStore.getState(), 'answerQuestion').mockResolvedValue(undefined);
    renderTakeover();
    expect(screen.queryByTestId('question-submit')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await vi.waitFor(() => expect(answer).toHaveBeenCalled());
    const [, payload] = answer.mock.calls[0] as unknown as [string, { answers: { selected: number[] }[] }];
    expect(payload.answers).toEqual([{ selected: [] }, { selected: [] }]);
    answer.mockRestore();
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

describe('QuestionTakeover · 单选选中自动跳下一未答题', () => {
  beforeEach(() => {
    localStorage.setItem('zhuye.locale', 'en');
  });
  afterEach(() => cleanup());

  const THREE_SINGLE = {
    id: 'q-3',
    kind: 'question',
    turnId: 'turn-3',
    payload: {
      questions: [0, 1, 2].map((n) => ({
        header: `Q${n}`,
        question: `Question ${n}?`,
        multi_select: false,
        options: [
          { label: `A${n}`, description: 'first' },
          { label: `B${n}`, description: 'second' },
        ],
      })),
    },
  } as unknown as PendingQuestion;

  it('单选选中即自动跳到下一个未答题', () => {
    renderTakeover();
    fireEvent.click(screen.getByText('Pear'));
    // 未点页签,自动落到第二题。
    expect(screen.getByText('Choose features?')).toBeDefined();
    expect(screen.queryByText('Choose a fruit?')).toBeNull();
  });

  it('自动跳会越过已答题,落到下一个未答题', () => {
    renderTakeover();
    // 先答第二题(多选,勾 Auth 不跳),再回第一题单选 —— 应越过已答的第二题…
    fireEvent.click(screen.getByTestId('question-tab-1'));
    fireEvent.click(screen.getByText('Auth'));
    fireEvent.click(screen.getByTestId('question-tab-0'));
    fireEvent.click(screen.getByText('Pear'));
    // 只有两题,前方无未答题 → 原地停留(不会跳到不存在的题)。
    expect(screen.getByText('Choose a fruit?')).toBeDefined();
  });

  it('多选勾选不自动跳(连续勾选不被打断)', () => {
    renderTakeover();
    fireEvent.click(screen.getByTestId('question-tab-1'));
    fireEvent.click(screen.getByText('Auth'));
    expect(screen.getByText('Choose features?')).toBeDefined();
    fireEvent.click(screen.getByText('Audit'));
    expect(screen.getByText('Choose features?')).toBeDefined();
  });

  it('三道单选题逐题自动前进,末题答完原地停留', () => {
    renderTakeover(THREE_SINGLE);
    fireEvent.click(screen.getByText('A0'));
    expect(screen.getByText('Question 1?')).toBeDefined();
    fireEvent.click(screen.getByText('A1'));
    expect(screen.getByText('Question 2?')).toBeDefined();
    fireEvent.click(screen.getByText('A2'));
    // 末题答完:停留原地(不越界),提交按钮由 allAnswered 门控出现。
    expect(screen.getByText('Question 2?')).toBeDefined();
    expect(screen.getByTestId('question-submit')).toBeDefined();
  });

  it('三题答完前自动跳会越过已答题落到未答题', () => {
    renderTakeover(THREE_SINGLE);
    // 先跳到第二题答掉它,再回第一题 —— 选完 A0 应越过 Q1(已答)落到 Q2。
    fireEvent.click(screen.getByTestId('question-tab-1'));
    fireEvent.click(screen.getByText('A1'));
    fireEvent.click(screen.getByTestId('question-tab-0'));
    fireEvent.click(screen.getByText('A0'));
    expect(screen.getByText('Question 2?')).toBeDefined();
  });
});
