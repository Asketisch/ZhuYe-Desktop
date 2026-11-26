/**
 * 会话级提示词预设偏好测试 —— 读写/'new' 转正/bind 恢复三分支。
 *
 * zhuye_prompt_command 被 mock:断言 select 提交的 wire 形状与触发时机,
 * 不走 IPC;store 的 prompt 状态用 zustand setState 直接摆放。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const promptCommand = vi.fn(async () => 'sub-1');
vi.mock('@/utils/commands/prompts', () => ({
  zhuye_prompt_command: (...args: unknown[]) => promptCommand(...(args as [])),
}));

import { useAgentStore } from './store';
import {
  movePromptSelection,
  readPromptSelection,
  syncPlanPresetPermissionMode,
  syncSessionPromptSelection,
  writePromptSelection,
} from './promptSelection';

beforeEach(() => {
  localStorage.clear();
  promptCommand.mockClear();
  useAgentStore.setState({ prompt: null });
});

describe('per-session prompt selection', () => {
  it('keeps selections separate per session and defaults to null', () => {
    writePromptSelection('a', { mode: 'manual', profile: 'gpt' });
    writePromptSelection('b', { mode: 'auto' });
    expect(readPromptSelection('a')).toEqual({ mode: 'manual', profile: 'gpt' });
    expect(readPromptSelection('b')).toEqual({ mode: 'auto' });
    expect(readPromptSelection('c')).toBeNull(); // null = 跟随全局默认
  });

  it('promotes the pre-create key and clears it', () => {
    writePromptSelection('new', { mode: 'manual', profile: 'claude' });
    movePromptSelection('new', 'sess-1');
    expect(readPromptSelection('sess-1')).toEqual({ mode: 'manual', profile: 'claude' });
    expect(readPromptSelection('new')).toBeNull();
  });

  it('promoting an absent key is a no-op', () => {
    movePromptSelection('new', 'sess-2');
    expect(readPromptSelection('sess-2')).toBeNull();
  });
});

describe('syncSessionPromptSelection (bind 恢复 —— 按后端权威值判定)', () => {
  // v1.13:第二参数是后端 `zhuye_bind_session` 回传的该会话**权威
  // override**(取自 rollout 末次 PromptSelectionChanged;null = 无覆盖
  // = 跟随全局默认)。前端不再拿自己的 `store.prompt.selection` 镜像
  // 当依据 —— 镜像会回落到全局默认,既让每次切会话都误弹「提示词已
  // 刷新」,又因初始为 null 漏下发 Select 让上个会话串味到下个会话。

  it('有记录且与权威值不同 → 提交该记录', () => {
    writePromptSelection('s1', { mode: 'manual', profile: 'gpt' });
    syncSessionPromptSelection('s1', null);
    expect(promptCommand).toHaveBeenCalledWith({ type: 'select', selection: { mode: 'manual', profile: 'gpt' } });
  });

  it('有记录且与权威值相同 → 不提交(不写冗余 rollout,也不弹 toast)', () => {
    writePromptSelection('s1', { mode: 'manual', profile: 'gpt' });
    syncSessionPromptSelection('s1', { mode: 'manual', profile: 'gpt' });
    expect(promptCommand).not.toHaveBeenCalled();
  });

  it('无记录但权威值有覆盖(上个会话残留) → 提交 Select(null) 恢复跟随默认', () => {
    syncSessionPromptSelection('s2', { mode: 'manual', profile: 'qwen' });
    expect(promptCommand).toHaveBeenCalledWith({ type: 'select', selection: null });
  });

  it('无记录且权威值为 null(已是跟随默认) → 跳过', () => {
    syncSessionPromptSelection('s3', null);
    expect(promptCommand).not.toHaveBeenCalled();
  });

  it('null 与 {mode:default} 不等价(前者=无覆盖,后者=显式覆盖)', () => {
    writePromptSelection('s4', { mode: 'default' });
    // 权威值是 null(无覆盖) ≠ 显式 default → 需要下发。
    syncSessionPromptSelection('s4', null);
    expect(promptCommand).toHaveBeenCalledWith({ type: 'select', selection: { mode: 'default' } });
  });

  it('端到端:首页选 gpt → 创建转正 → bind 恢复提交 manual{gpt}', () => {
    writePromptSelection('new', { mode: 'manual', profile: 'gpt' });
    movePromptSelection('new', 'sess-e2e');
    syncSessionPromptSelection('sess-e2e', null);
    expect(promptCommand).toHaveBeenCalledWith({ type: 'select', selection: { mode: 'manual', profile: 'gpt' } });
  });
});

describe('syncPlanPresetPermissionMode (/plan 预设联动工作模式)', () => {
  /** 摆放会话预设与 setPermissionMode 间谍,返回调用记录数组。 */
  function arrange(sessionId: string, profile: string, mode: string) {
    const calls: string[] = [];
    writePromptSelection(sessionId, { mode: 'manual', profile });
    useAgentStore.setState({
      permissionMode: mode as 'plan',
      setPermissionMode: async (next: string) => { calls.push(next); },
    });
    return calls;
  }

  it('新会话选了 /plan 预设 → 工作模式校准到 plan', () => {
    const calls = arrange('plan-new', 'plan', 'auto');
    syncPlanPresetPermissionMode('plan-new', false);
    expect(calls).toEqual(['plan']);
  });

  it('有落盘记录的老会话不校准(尊重已持久化的权限模式)', () => {
    const calls = arrange('plan-old', 'plan', 'prompt');
    syncPlanPresetPermissionMode('plan-old', true);
    expect(calls).toEqual([]);
  });

  it('非 plan 预设 / 已在 plan 模式均跳过', () => {
    const callsA = arrange('sess-a', 'code-review', 'auto');
    syncPlanPresetPermissionMode('sess-a', false);
    expect(callsA).toEqual([]);
    const callsB = arrange('sess-b', 'plan', 'plan');
    syncPlanPresetPermissionMode('sess-b', false);
    expect(callsB).toEqual([]);
  });
});
