/**
 * 键盘可达性 —— 焦点陷阱与 Escape 语义的集成层锁定。
 *
 * `ModalShell.test.tsx`(单元)已覆盖 role/aria-modal/Esc/焦点恢复;
 * 这里补两件单元层锁不到的事:
 *   1. **Tab 焦点陷阱**:真实 ModalStack + 事件驱动打开的模态,连按 Tab
 *      焦点始终留在 dialog 内(键盘用户不会被弹窗后面的侧栏截走);
 *   2. **Escape 的线上回执**:Escape 不是单纯关闭 —— 审批弹窗必须回发
 *      `deny{reason:"dismissed"}`、plan 弹窗必须回发 `revise`,
 *      agent 侧才不会永远挂在等待上。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderView } from './helpers/appHarness';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { ModalStack } from '@/features/modals';
import { useAgentStore } from '@/stores/agentStore';

let backend: FakeBackend;
let unsub: (() => void) | null = null;

beforeEach(() => {
  backend = installFakeBackend();
  useAgentStore.getState().reset();
  unsub = useAgentStore.getState().subscribe();
  renderView(<ModalStack />);
});

afterEach(() => {
  unsub?.();
  unsub = null;
});

const TURN = 'sub-a11y-keyboard';

/** 连按 Tab n 次,断言焦点始终在 dialog 内部。 */
async function tabStaysTrapped(dialog: HTMLElement, presses: number) {
  for (let i = 0; i < presses; i += 1) {
    fireEvent.keyDown(dialog, { key: 'Tab' });
    const el = document.activeElement;
    expect(
      el && dialog.contains(el),
      `第 ${i + 1} 次 Tab 后焦点逃出了 dialog:当前 ${el?.outerHTML.slice(0, 120)}`,
    ).toBe(true);
  }
}

describe('keyboard a11y: approval modal', () => {
  it('traps Tab focus inside the dialog and Escape sends deny{dismissed} on the wire', async () => {
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-a11y',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'ls -la' } },
      risk: 'low',
    });
    const title = await screen.findByText('Tool Approval');
    const dialog = title.closest('[role=' + '"dialog"]') as HTMLElement;

    await tabStaysTrapped(dialog, 8);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Tool Approval')).toBeNull();
    });
    // Escape 的线上语义:驳回(dismissed),agent 不再等待。
    const receipt = backend.agent.toolApprovals.at(-1);
    expect(receipt?.id).toBe('apr-a11y');
    expect(receipt?.decision).toEqual({ deny: { reason: 'dismissed' } });
  });
});

describe('keyboard a11y: plan ready modal', () => {
  it('traps Tab focus and Escape sends revise on the wire', async () => {
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-a11y',
      markdown: '# 键盘可达性探针计划\n- step 1',
    });
    const dialogEl = await waitFor(() => {
      const el = document.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });

    await tabStaysTrapped(dialogEl, 8);

    fireEvent.keyDown(dialogEl, { key: 'Escape' });
    // Escape 的线上语义:回发 revise(等价 dismiss)。
    await waitFor(() => {
      const receipt = backend.agent.planChoices.at(-1);
      expect(receipt?.id).toBe('plan-a11y');
      expect(receipt?.choice).toBe('revise');
    });
    // 模态关闭是事件驱动的:agent 侧确认(plan_rejected)后才清除。
    emitEvent(TURN, { type: 'plan_rejected', plan_id: 'plan-a11y' });
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  });
});

describe('keyboard a11y: stacked modals', () => {
  it('only the topmost rendered modal answers Escape; the covered one stays', async () => {
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-bottom',
      markdown: '# 底层-plan-弹窗',
    });
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-top',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'echo' } },
      risk: 'low',
    });
    await screen.findByText('Tool Approval');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(2);

    // ModalStack 的渲染顺序固定:plan 弹窗永远渲染在审批之后 —— 它同时是
    // 视觉栈顶(DOM 最后 = 覆盖在上)与交互栈顶(modalStack 最后挂载)。
    // Escape 只应作用于它;被覆盖的审批弹窗原样保留、不发回执。
    const top = dialogs[dialogs.length - 1] as HTMLElement;
    expect(top.getAttribute('aria-label')).toBe('Plan Ready');
    fireEvent.keyDown(top, { key: 'Escape' });
    await waitFor(() => {
      const receipt = backend.agent.planChoices.at(-1);
      expect(receipt?.id).toBe('plan-bottom');
      expect(receipt?.choice).toBe('revise');
    });
    expect(screen.queryByText('Tool Approval')).toBeTruthy();
    expect(backend.agent.toolApprovals).toEqual([]);
  });
});
