/**
 * PromptPicker —— 底栏左侧的提示词预设 pill（权限按钮右边）。
 *
 * 会话级提示词预设偏好（per-session localStorage，null 会话走 'new'
 * 预创建键，创建后转正；bind 恢复在 ChatBinding）。入口只在「最初创建
 * 会话」窗口（turns 为空）显示 —— 会话开始后锁定，系统提示词恒定是
 * 供应商 prompt cache 命中的前提。选项 = 跟随默认 + 智能匹配模型 +
 * prompt_list 事件回流的可用层（不含 default 层）。
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '@/utils/i18n';
import { useAgentStore } from '@/stores/agentStore';
import { readPromptSelection, writePromptSelection } from '@/stores/agent/promptSelection';
import type { PromptSelection } from '@/utils/commands/prompts';
import s from '@/render/composer/PromptPicker.module.css';

/** zustand selector 的稳定空引用 —— 数组字段用 `?? []` 每次新建会让
 *  useSyncExternalStore 快照永不相等而无限重渲染。 */
const NO_PROMPT_LAYERS: readonly string[] = [];

export function PromptPicker() {
  const { t } = useI18n();
  const sessionId = useAgentStore((st) => st.loadedSessionId);
  const turnsEmpty = useAgentStore((st) => st.turns.length === 0);
  const promptAvailable = useAgentStore((st) => st.prompt?.available ?? NO_PROMPT_LAYERS);
  const promptFallback = useAgentStore((st) => st.prompt?.fallbackReason ?? null);
  const promptList = useAgentStore((st) => st.promptList);
  const setPermissionMode = useAgentStore((st) => st.setPermissionMode);

  const [selection, setSelection] = useState<PromptSelection>(
    () => readPromptSelection(sessionId) ?? { mode: 'default' },
  );
  useEffect(() => { setSelection(readPromptSelection(sessionId) ?? { mode: 'default' }); }, [sessionId]);

  // 可用层清单（prompt_list 事件异步回流）—— 空会话挂载时拉一次。
  // catch 防御:拉取失败不阻断 composer(选项退化为默认/智能两项)。
  useEffect(() => {
    if (turnsEmpty && useAgentStore.getState().prompt === null) {
      promptList().catch(() => { /* 清单拉不到就用默认两项 */ });
    }
  }, [turnsEmpty, promptList]);

  const layers = useMemo(
    () => promptAvailable.filter((layer) => layer !== 'default'),
    [promptAvailable],
  );

  // 会话开始后锁定 —— 整个 pill 消失（渲染层无状态，直接短路）。
  if (!turnsEmpty) return null;

  const value = selection.mode === 'manual' ? selection.profile : selection.mode;
  const onPick = (raw: string) => {
    const next: PromptSelection = raw === 'default' || raw === 'auto'
      ? { mode: raw }
      : { mode: 'manual', profile: raw };
    setSelection(next);
    writePromptSelection(sessionId, next);
    // plan 预设联动工作模式:选中 /plan 即直接进入计划模式。引擎在
    // PermissionMode::Plan 下跳过 EnterPlanMode 的审批派发(tool_exec
    // 防御守卫),用户不再看到「进入计划模式?」确认框。切回非 plan
    // 预设不改模式 —— 模式入口在权限下拉(PermissionPicker)。
    // 首页(未建会话)下发的模式只落在占位线程上,首条消息建会话后的
    // 正式校准在 syncPlanPresetPermissionMode(bind → replay 为空时)。
    if (next.mode === 'manual' && next.profile === 'plan') {
      setPermissionMode('plan').catch(() => { /* 占位线程未就绪等失败:建会话后会再校准 */ });
    }
  };

  return (
    <span className={s.wrap} data-testid="composer-prompt-picker">
      <select
        className={s.select}
        value={value}
        onChange={(event) => onPick(event.target.value)}
        title={selection.mode === 'auto' && promptFallback
          ? promptFallback
          : t('composer.controls.prompt.hint')}
        aria-label={t('composer.controls.promptAria')}
        data-testid="composer-prompt-select"
      >
        <option value="default">{t('composer.controls.prompt.follow')}</option>
        <option value="auto">{t('composer.controls.prompt.auto')}</option>
        {layers.map((layer) => (
          <option key={layer} value={layer}>{layer}</option>
        ))}
      </select>
      <ChevronDown size={12} className={s.caret} aria-hidden="true" />
    </span>
  );
}
