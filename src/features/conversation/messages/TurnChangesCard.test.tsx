/**
 * TurnChangesCard —— 每轮末尾「本轮改动」卡的行为测试。
 *
 * 覆盖：无改动不渲染、折叠头计数、展开后逐文件行、「审查」展开 diff。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@/utils/i18n';
import { TurnChangesCard } from '@/features/conversation/messages/TurnChangesCard';
import type { Turn, TurnItem } from '@/stores/agent/types';

function turnWith(items: TurnItem[]): Turn {
  return { id: 'turn-1', status: 'done', items };
}

const EDIT_TURN = turnWith([
  { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c1', status: 'done' },
  {
    kind: 'tool_output',
    callId: 'c1',
    text: '',
    isError: false,
    path: '/w/src/app.ts',
    diff: '--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
  },
]);

function renderCard(turn: Turn) {
  return render(
    <I18nProvider>
      <TurnChangesCard turn={turn} />
    </I18nProvider>,
  );
}

describe('TurnChangesCard', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it('本轮无改动 → 不渲染卡片', () => {
    renderCard(turnWith([
      { kind: 'tool_call', toolName: 'bash', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: 'ok', isError: false },
    ]));
    expect(screen.queryByTestId('turn-changes-card')).toBeNull();
  });

  it('折叠头显示文件数与增删行数', () => {
    renderCard(EDIT_TURN);
    const card = screen.getByTestId('turn-changes-card');
    expect(card.textContent).toContain('1');
    expect(card.textContent).toContain('+1');
    expect(card.textContent).toContain('−1');
  });

  it('展开后列出改动文件（路径只显示末两段）', () => {
    renderCard(EDIT_TURN);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const row = screen.getByTestId('turn-change-row');
    expect(row.textContent).toContain('src/app.ts');
    // 完整绝对路径留在 title 上。
    expect(row.querySelector('[title]')?.getAttribute('title')).toContain('/w/src/app.ts');
  });

  it('「审查」展开该文件的 diff', () => {
    renderCard(EDIT_TURN);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByTestId('turn-change-review'));
    const review = screen.getByTestId('turn-diff-review');
    expect(review.textContent).toContain('-old');
    expect(review.textContent).toContain('+new');
  });

  it('无 diff 正文的改动不给「审查」入口', () => {
    renderCard(turnWith([
      { kind: 'tool_call', toolName: 'edit', argsSummary: '{}', callId: 'c1', status: 'done' },
      { kind: 'tool_output', callId: 'c1', text: 'done', isError: false, path: '/w/a.txt' },
    ]));
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByTestId('turn-change-row')).toBeTruthy();
    expect(screen.queryByTestId('turn-change-review')).toBeNull();
  });
});
