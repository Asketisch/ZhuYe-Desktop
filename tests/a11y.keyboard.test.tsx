/**
 * 键盘可达性 —— 焦点陷阱与 Escape 语义的集成层锁定。
 *
 * `ModalShell.test.tsx`(单元)已覆盖 role/aria-modal/Esc/焦点恢复;
 * 这里补两件单元层锁不到的事:
 *   1. **Tab 焦点陷阱**:真实 ModalStack + 事件驱动打开的模态,连按 Tab
 *      焦点始终留在 dialog 内(键盘用户不会被弹窗后面的侧栏截走);
 *   2. **Escape 的线上回执**:Escape 不是单纯关闭 —— 审批弹窗必须回发
 *      `deny{reason:"dismissed"}`,agent 侧才不会永远挂在等待上。
 *
 * 计划审批已迁出模态栈（右 dock 计划页签 + composer 审批条）：
 * plan 挂起不再产生 dialog，也不占用 Escape 语义。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderView } from './helpers/appHarness';
import { installFakeBackend, emitEvent, type FakeBackend } from './helpers/fakeBackend';
import { ModalStack } from '@/features/harness/modals';
import { PlanApprovalBar } from '@/features/input/composer/PlanApprovalBar';
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

describe('keyboard a11y: plan approval bar（不再占用模态/Escape 语义）', () => {
  it('plan_ready 渲染审批条而非 dialog；按钮可键盘触发并回发对应决策', async () => {
    renderView(<PlanApprovalBar />);
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-a11y',
      markdown: '# 键盘可达性探针计划\n- step 1',
    });
    const bar = await screen.findByTestId('composer-plan-bar');
    // 不产生 dialog：计划正文与审批都在非模态面里（右侧 dock / 输入框上方）。
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[aria-label="Plan Ready"]')).toBeNull();

    // 键盘触发：聚焦按钮 + Enter 等价点击（native button 语义）。
    const approve = within(bar).getByTestId('plan-bar-approve') as HTMLButtonElement;
    approve.focus();
    fireEvent.keyDown(approve, { key: 'Enter' });
    fireEvent.click(approve);
    await waitFor(() => {
      const receipt = backend.agent.planChoices.at(-1);
      expect(receipt?.id).toBe('plan-a11y');
      expect(receipt?.choice).toBe('auto_mode');
    });
  });
});

describe('keyboard a11y: stacked modals', () => {
  it('计划挂起不再参与模态堆叠：只有审批一个 dialog，Escape 仅作用于它', async () => {
    renderView(<PlanApprovalBar />);
    emitEvent(TURN, {
      type: 'plan_ready',
      plan_id: 'plan-bottom',
      markdown: '# 底层-plan（现在只在审批条/右侧 dock）',
    });
    emitEvent(TURN, {
      type: 'approval_request',
      request_id: 'apr-top',
      kind: { type: 'tool', tool_name: 'bash', args: { cmd: 'echo' } },
      risk: 'low',
    });
    await screen.findByText('Tool Approval');
    await screen.findByTestId('composer-plan-bar');
    const dialogs = document.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(1);

    // Escape 只作用于审批弹窗；计划挂起原样保留、不发回执。
    fireEvent.keyDown(dialogs[0], { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByText('Tool Approval')).toBeNull();
    });
    expect(backend.agent.planChoices).toEqual([]);
    expect(useAgentStore.getState().pendingPlan?.id).toBe('plan-bottom');
  });
});
